// Supabase Edge Function: analisa o histórico de treino do usuário autenticado
// e devolve sugestões de exercícios, variações e técnicas de intensidade via Claude.
//
// A chave da Anthropic fica só aqui (variável de ambiente do projeto Supabase),
// nunca no navegador. Veja o README.md na raiz do repositório para o passo a
// passo de deploy e configuração.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é um personal trainer virtual analisando o histórico de treino de um usuário de academia. Responda sempre em português do Brasil.

Baseado no resumo de dados fornecido (JSON com exercícios registrados, cargas, frequência e grupos musculares), sugira:
1. Até 2 exercícios novos que complementariam a rotina atual (grupos musculares pouco trabalhados ou desequilíbrios).
2. Até 2 variações de exercícios já feitos pelo usuário, para quebrar platô ou adicionar estímulo novo.
3. Até 2 técnicas de intensificação (como drop set, rest-pause, bi-set, série negativa) aplicáveis a exercícios específicos do histórico do usuário.

Seja específico: cite exercícios pelo nome exato como aparecem nos dados. Cada sugestão deve ter um título curto e uma descrição de 1-2 frases explicando o porquê, baseada nos dados reais.

Inclua também um "insight" geral de 1-2 frases sobre o padrão de treino observado (ex: grupo muscular negligenciado, boa progressão de carga em algum exercício, falta de variação).

Responda SOMENTE com um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{"insight": "string", "suggestions": [{"type": "exercicio" | "variacao" | "tecnica", "title": "string", "description": "string"}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({ error: "ANTHROPIC_API_KEY não configurada neste projeto Supabase." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }
    const user = userData.user;

    const { data: workouts, error: workoutsError } = await supabase
      .from("workouts")
      .select("date, muscle_group, exercise, sets, note, feeling")
      .order("date", { ascending: true });
    if (workoutsError) throw workoutsError;

    if (!workouts || workouts.length < 3) {
      return jsonResponse({ error: "Registre pelo menos 3 treinos para receber sugestões." }, 400);
    }

    const summary = summarizeWorkouts(workouts);
    const suggestion = await callClaude(summary);

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ ai_suggestions: suggestion, ai_suggestions_at: new Date().toISOString() })
      .eq("id", user.id);
    if (updateError) console.error("Erro ao salvar sugestões no perfil:", updateError);

    return jsonResponse({ suggestion });
  } catch (e) {
    console.error("Erro em analyze-workouts:", e);
    return jsonResponse({ error: "Não foi possível gerar sugestões agora. Tente novamente mais tarde." }, 500);
  }
});

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

function summarizeWorkouts(workouts: WorkoutRow[]) {
  type ExerciseAgg = {
    group: string;
    sessions: number;
    notes: Set<string>;
    maxWeight: number;
    lastDate: string;
    lastSets: { peso: number; reps: number }[];
    feelings: string[];
  };

  const byExercise: Record<string, ExerciseAgg> = {};
  const groupLastDate: Record<string, string> = {};
  const daySet = new Set<string>();

  for (const w of workouts) {
    daySet.add(w.date);
    if (!groupLastDate[w.muscle_group] || w.date > groupLastDate[w.muscle_group]) {
      groupLastDate[w.muscle_group] = w.date;
    }
    if (!byExercise[w.exercise]) {
      byExercise[w.exercise] = {
        group: w.muscle_group,
        sessions: 0,
        notes: new Set(),
        maxWeight: 0,
        lastDate: w.date,
        lastSets: [],
        feelings: [],
      };
    }
    const e = byExercise[w.exercise];
    e.sessions++;
    if (w.note) e.notes.add(w.note);
    if (w.feeling) e.feelings.push(w.feeling);
    if (w.date >= e.lastDate) {
      e.lastDate = w.date;
      e.lastSets = w.sets || [];
    }
    for (const s of w.sets || []) {
      if (s.peso > e.maxWeight) e.maxWeight = s.peso;
    }
  }

  const exercises = Object.entries(byExercise).map(([name, e]) => {
    const last = e.lastSets[e.lastSets.length - 1];
    return {
      exercise: name,
      group: e.group,
      sessions: e.sessions,
      maxWeight: e.maxWeight,
      lastWeight: last ? last.peso : null,
      lastReps: last ? last.reps : null,
      variationsTried: [...e.notes],
      recentFeelings: e.feelings.slice(-3),
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const daysSince = (d: string) => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
  const muscleGroupGaps = Object.entries(groupLastDate).map(([group, date]) => ({
    group,
    daysSinceLastTrained: daysSince(date),
  }));

  return {
    totalWorkoutDays: daySet.size,
    totalExercisesLogged: workouts.length,
    exercises,
    muscleGroupGaps,
  };
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function callClaude(summary: unknown) {
  const response = await anthropic.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    output_config: { effort: "medium" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(summary) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("A IA não conseguiu gerar sugestões para esses dados.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && "text" in textBlock ? textBlock.text : "";
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
