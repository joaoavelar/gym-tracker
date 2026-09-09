// Supabase Edge Function: dashboard de administração, só para o criador do
// app. Lista quem está cadastrado e alguns dados de uso de cada pessoa.
//
// Segurança: o acesso é decidido aqui no servidor, comparando o e-mail de
// quem chamou (via o token JWT) com o segredo ADMIN_EMAIL do projeto - nunca
// confia em nada vindo do navegador. Os dados em si só saem do banco porque
// esta função usa a service role key (que o Supabase já injeta sozinho em
// toda Edge Function, não precisa configurar) para ignorar as regras de RLS
// só nesta rota. Veja o README.md para o passo a passo de deploy.

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Mesma lógica de sequência de dias treinados usada no app (index.html),
// mas recebendo só as datas de um usuário.
function computeStreak(dates: string[], todayISO: string): number {
  const daySet = new Set(dates);
  let streak = 0;
  const cursor = new Date(todayISO + "T00:00:00");
  if (!daySet.has(todayISO)) cursor.setDate(cursor.getDate() - 1);
  const toISO = (d: Date) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  while (daySet.has(toISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!ADMIN_EMAIL) {
      return jsonResponse({ error: "ADMIN_EMAIL não configurado neste projeto Supabase." });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autenticado." });
    }

    // Cliente com a permissão de quem chamou, só pra confirmar quem é.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData?.user) {
      return jsonResponse({ error: "Não autenticado." });
    }
    const callerEmail = (callerData.user.email || "").trim().toLowerCase();
    if (callerEmail !== ADMIN_EMAIL) {
      return jsonResponse({ error: "Acesso restrito ao administrador do app." });
    }

    // Daqui pra baixo, cliente com a service role key: ignora RLS de propósito,
    // só porque já confirmamos acima que quem está pedindo é o admin.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [{ data: authUsers, error: authUsersError }, profilesRes, workoutsRes, weightRes, photosRes] =
      await Promise.all([
        admin.auth.admin.listUsers({ perPage: 200 }),
        admin.from("profiles").select("id, name, weekly_goal, monthly_goal, weight_goal_kg"),
        admin.from("workouts").select("user_id, date"),
        admin.from("body_weight_logs").select("user_id, date, weight_kg"),
        admin.from("workout_photos").select("user_id, date, storage_path"),
      ]);
    if (authUsersError) throw authUsersError;
    if (profilesRes.error) throw profilesRes.error;
    if (workoutsRes.error) throw workoutsRes.error;
    if (weightRes.error) throw weightRes.error;
    if (photosRes.error) throw photosRes.error;

    const profileById: Record<string, { name: string | null; weekly_goal: number | null; monthly_goal: number | null; weight_goal_kg: number | null }> = {};
    for (const p of profilesRes.data || []) profileById[p.id] = p;

    const workoutsByUser: Record<string, string[]> = {};
    for (const w of workoutsRes.data || []) {
      (workoutsByUser[w.user_id] ||= []).push(w.date);
    }

    const weightByUser: Record<string, { date: string; weight_kg: number }[]> = {};
    for (const wl of weightRes.data || []) {
      (weightByUser[wl.user_id] ||= []).push({ date: wl.date, weight_kg: wl.weight_kg });
    }

    const photosByUser: Record<string, { date: string; storage_path: string }[]> = {};
    for (const ph of photosRes.data || []) {
      (photosByUser[ph.user_id] ||= []).push({ date: ph.date, storage_path: ph.storage_path });
    }

    const todayISO = new Date().toISOString().slice(0, 10);

    const users = await Promise.all(
      (authUsers?.users || []).map(async (u) => {
        const dates = (workoutsByUser[u.id] || []).sort();
        const weightLogs = (weightByUser[u.id] || []).sort((a, b) => b.date.localeCompare(a.date));
        const photos = photosByUser[u.id] || [];

        const photosWithUrls = await Promise.all(
          photos.map(async (ph) => {
            const { data: signed } = await admin.storage
              .from("workout-photos")
              .createSignedUrl(ph.storage_path, 3600);
            return { date: ph.date, url: signed?.signedUrl || null };
          }),
        );

        return {
          id: u.id,
          email: u.email,
          name: profileById[u.id]?.name || null,
          createdAt: u.created_at,
          lastSignInAt: u.last_sign_in_at || null,
          weeklyGoal: profileById[u.id]?.weekly_goal ?? null,
          monthlyGoal: profileById[u.id]?.monthly_goal ?? null,
          weightGoalKg: profileById[u.id]?.weight_goal_kg ?? null,
          workoutsCount: dates.length,
          lastWorkoutDate: dates.length ? dates[dates.length - 1] : null,
          currentStreak: computeStreak(dates, todayISO),
          latestWeightKg: weightLogs[0]?.weight_kg ?? null,
          latestWeightDate: weightLogs[0]?.date ?? null,
          weightLogsCount: weightLogs.length,
          photos: photosWithUrls.sort((a, b) => b.date.localeCompare(a.date)),
        };
      }),
    );

    users.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    return jsonResponse({ users });
  } catch (e) {
    console.error("Erro em admin-dashboard:", e);
    return jsonResponse({ error: "Não foi possível carregar o dashboard agora." });
  }
});
