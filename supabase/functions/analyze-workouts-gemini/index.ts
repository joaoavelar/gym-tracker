// Supabase Edge Function: mesma análise de treino do analyze-workouts, mas
// chamando o Gemini (Google AI Studio) em vez da Claude - o Gemini tem um
// nível gratuito de verdade, então serve pra testar a funcionalidade de IA
// sem gastar nada. A chave fica só aqui (variável de ambiente do projeto
// Supabase), nunca no navegador. Veja o README.md para o passo a passo de
// deploy e configuração, e para trocar de volta pra Claude quando quiser.

import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Modelo gratuito do Gemini (Google AI Studio). Se quiser trocar, veja a
// lista de modelos disponíveis e seus limites gratuitos em
// https://ai.google.dev/gemini-api/docs/models
const MODEL = "gemini-2.0-flash";

// Mesmo limite de uso do analyze-workouts: evita chamadas repetidas em
// pouco tempo. O nível gratuito do Gemini também tem um limite diário de
// chamadas, então isso ajuda a não estourar ele sozinho.
const MIN_INTERVAL_MINUTES = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é um personal trainer virtual analisando o histórico de treino de um usuário de academia Smart Fit. Responda sempre em português do Brasil.

Você recebe um JSON com: exercícios registrados (com histórico recente de carga por sessão), grupos musculares e há quantos dias cada um foi treinado, quantos dias o usuário está sem treinar no geral, meta semanal, e a preferência de tempo de descanso entre séries.

Gere de 3 a 6 sugestões, cobrindo os tipos que fizerem sentido para os dados (não precisa usar todos os tipos):

- "grupo": um grupo muscular sendo negligenciado (muitos dias sem treinar comparado aos outros) que vale treinar em breve.
- "exercicio": um exercício novo (que não está na lista de exercícios já feitos) que complementaria a rotina atual.
- "variacao": uma variação de um exercício que o usuário já faz, mas ainda não tentou (compare com "variationsTried" desse exercício), para quebrar platô. Cada item de "recentSessions" tem o campo "note" com a variação usada naquela sessão específica (ex: "barra reta", "pegada supinada") - use isso para ver se o usuário sempre repete a mesma variação (sugira trocar) ou se uma troca recente de variação coincidiu com queda de carga (pode explicar na descrição).
- "carga": análise de progressão de peso em um exercício específico, usando o histórico de sessões recentes (campo "recentSessions", com peso, reps e a nota/variação de cada sessão). Só sugira AUMENTAR carga se houver progressão consistente e o usuário estiver treinando com regularidade (poucos dias parado). Se "daysSinceLastWorkout" for alto (ex: mais de 10-14 dias sem treinar), NÃO sugira aumento de carga em nenhum exercício - ao contrário, sugira REDUZIR o peso na volta (ex: 10-20% a menos) para evitar lesão por perda de condicionamento, e explique isso claramente na descrição.
- "tecnica": técnica de intensificação (drop set, rest-pause, bi-set, série negativa, redução do tempo de descanso) para um exercício específico. Use "restPreferenceSeconds" como contexto: se o descanso preferido for longo (ex: acima de 90s) e o treino já estiver consistente, pode sugerir encurtar o descanso ou usar uma técnica de intensidade para tornar o treino mais intenso.

Regra de segurança acima de tudo: nunca sugira aumento de carga para quem está há muitos dias sem treinar. Priorize sempre evitar lesão em vez de maximizar performance.

Seja específico: cite exercícios pelo nome exato como aparecem nos dados, e números reais (pesos, dias) quando fizer a sugestão. Cada sugestão deve ter um título curto (até ~6 palavras) e uma descrição de 1-2 frases explicando o porquê, baseada nos dados reais recebidos.

Inclua também um "insight" geral de 1-2 frases sobre o padrão de treino observado.

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{"insight": "string", "suggestions": [{"type": "grupo" | "exercicio" | "variacao" | "carga" | "tecnica", "title": "string", "description": "string"}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!GEMINI_API_KEY) {
      return jsonResponse({ error: "GEMINI_API_KEY não configurada neste projeto Supabase." });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autenticado." });
    }

    let restPreferenceSeconds: number | null = null;
    try {
      const body = await req.json();
      if (body && typeof body.restPreferenceSeconds === "number") {
        restPreferenceSeconds = body.restPreferenceSeconds;
      }
    } catch {
      // corpo vazio ou inválido - segue sem a preferência de descanso
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Não autenticado." });
    }
    const user = userData.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("weekly_goal, monthly_goal, ai_suggestions_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.ai_suggestions_at) {
      const elapsedMinutes = (Date.now() - new Date(profile.ai_suggestions_at).getTime()) / 60000;
      if (elapsedMinutes < MIN_INTERVAL_MINUTES) {
        const retryAfterMinutes = Math.ceil(MIN_INTERVAL_MINUTES - elapsedMinutes);
        return jsonResponse({
          error: `Você já analisou seus treinos recentemente. Tente novamente em ${formatMinutes(retryAfterMinutes)}.`,
          retryAfterMinutes,
        });
      }
    }

    const { data: workouts, error: workoutsError } = await supabase
      .from("workouts")
      .select("date, muscle_group, exercise, sets, note, feeling")
      .order("date", { ascending: true });
    if (workoutsError) throw workoutsError;

    if (!workouts || workouts.length < 3) {
      return jsonResponse({ error: "Registre pelo menos 3 treinos para receber sugestões." });
    }

    const summary = summarizeWorkouts(
      workouts,
      profile?.weekly_goal ?? null,
      profile?.monthly_goal ?? null,
      restPreferenceSeconds,
    );
    const suggestion = await callGemini(summary);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ ai_suggestions: suggestion, ai_suggestions_at: new Date().toISOString() })
      .eq("id", user.id);
    if (updateError) console.error("Erro ao salvar sugestões no perfil:", updateError);

    return jsonResponse({ suggestion });
  } catch (e) {
    console.error("Erro em analyze-workouts-gemini:", e);
    return jsonResponse({ error: "Não foi possível gerar sugestões agora. Tente novamente mais tarde." });
  }
});

function formatMinutes(totalMinutes: number) {
  if (totalMinutes < 60) return `${totalMinutes}min`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface WorkoutRow {
  date: string;
  muscle_group: string;
  exercise: string;
  sets: { peso: number; reps: number }[];
  note: string | null;
  feeling: string | null;
}

const MAX_RECENT_SESSIONS = 6;

function summarizeWorkouts(
  workouts: WorkoutRow[],
  weeklyGoal: number | null,
  monthlyGoal: number | null,
  restPreferenceSeconds: number | null,
) {
  type ExerciseAgg = {
    group: string;
    sessions: number;
    notes: Set<string>;
    recentSessions: { date: string; topWeight: number; reps: number; note: string | null }[];
    feelings: string[];
  };

  const byExercise: Record<string, ExerciseAgg> = {};
  const groupLastDate: Record<string, string> = {};
  const daySet = new Set<string>();
  let lastWorkoutDate: string | null = null;

  for (const w of workouts) {
    daySet.add(w.date);
    if (!lastWorkoutDate || w.date > lastWorkoutDate) lastWorkoutDate = w.date;
    if (!groupLastDate[w.muscle_group] || w.date > groupLastDate[w.muscle_group]) {
      groupLastDate[w.muscle_group] = w.date;
    }
    if (!byExercise[w.exercise]) {
      byExercise[w.exercise] = { group: w.muscle_group, sessions: 0, notes: new Set(), recentSessions: [], feelings: [] };
    }
    const e = byExercise[w.exercise];
    e.sessions++;
    if (w.note) e.notes.add(w.note);
    if (w.feeling) e.feelings.push(w.feeling);
    const sets = w.sets || [];
    if (sets.length > 0) {
      const top = sets.reduce((max, s) => (s.peso > max.peso ? s : max), sets[0]);
      e.recentSessions.push({ date: w.date, topWeight: top.peso, reps: top.reps, note: w.note || null });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const daysSince = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);

  const exercises = Object.entries(byExercise).map(([name, e]) => ({
    exercise: name,
    group: e.group,
    sessions: e.sessions,
    variationsTried: [...e.notes],
    recentFeelings: e.feelings.slice(-3),
    // ordenado do mais antigo para o mais recente, só as últimas sessões
    recentSessions: e.recentSessions
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-MAX_RECENT_SESSIONS),
  }));

  const muscleGroupGaps = Object.entries(groupLastDate).map(([group, date]) => ({
    group,
    daysSinceLastTrained: daysSince(date),
  }));

  return {
    today,
    totalWorkoutDays: daySet.size,
    daysSinceLastWorkout: lastWorkoutDate ? daysSince(lastWorkoutDate) : null,
    weeklyGoal,
    monthlyGoal,
    restPreferenceSeconds,
    exercises,
    muscleGroupGaps,
  };
}

// Chama a API do Gemini direto via fetch (sem SDK) - formato de requisição
// documentado em https://ai.google.dev/api/generate-content
async function callGemini(summary: unknown) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY!,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(summary) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 1500,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    console.error("Erro na API do Gemini:", response.status, errText);
    throw new Error(`Gemini respondeu ${response.status}.`);
  }

  const data = await response.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT") {
    throw new Error("O Gemini não conseguiu gerar sugestões para esses dados.");
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return parseSuggestionJson(text);
}

function parseSuggestionJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // segue para o erro abaixo
      }
    }
    throw new Error("Resposta inválida da IA.");
  }
}
