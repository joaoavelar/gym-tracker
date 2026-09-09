# Treino — Parceiro de Academia

App habit tracker de treino, feito para treinar o uso do Claude. Registra séries, pesos e repetições, acompanha sequência de dias treinados, metas semanais e evolução de peso por exercício.

Agora com **login real via Supabase Auth** — os treinos ficam salvos na nuvem, vinculados à sua conta, e sincronizam entre qualquer dispositivo.

## Como rodar

O app é um único arquivo `index.html`, sem build, sem framework. Basta configurar o Supabase e abrir o arquivo (ou publicar em qualquer hospedagem estática — GitHub Pages, Netlify, Vercel etc).

### 1. Criar o projeto no Supabase

1. Crie uma conta e um projeto em [supabase.com](https://supabase.com) (plano gratuito é suficiente).
2. No painel do projeto, vá em **SQL Editor** → **New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e execute. Isso cria as tabelas `profiles`, `workouts`, `body_weight_logs`, `workout_photos`, `custom_exercises` e `workout_templates`, o bucket de Storage `workout-photos` (privado) e as políticas de Row Level Security (cada pessoa só acessa os próprios dados e fotos). Se você já rodou esse script numa versão anterior do app, pode rodar de novo sem problema — ele só adiciona o que estiver faltando.
3. Vá em **Project Settings > API** e copie a **Project URL** e a chave **anon public**.

### 2. Configurar o app

Abra `index.html` e edite as duas constantes no início do `<script>`:

```js
const SUPABASE_URL = 'SUA_SUPABASE_URL_AQUI';
const SUPABASE_ANON_KEY = 'SUA_SUPABASE_ANON_KEY_AQUI';
```

Cole a URL e a chave copiadas no passo anterior.

### 3. (Opcional) Confirmação de e-mail

Por padrão o Supabase exige confirmação de e-mail antes do primeiro login. Para testar rapidamente sem configurar envio de e-mail, você pode desativar isso em **Authentication > Providers > Email > Confirm email** (desmarque a opção) — não recomendado para produção.

### 4. (Opcional) Login com Google

O botão "Entrar com Google" já está no app, mas só funciona depois de configurar um provedor OAuth. O login com Google exige uma URL `http(s)`, então só funciona quando o app é acessado pelo link publicado (GitHub Pages), não abrindo o `index.html` local.

**No Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):

1. Crie um projeto (ou use um existente).
2. **APIs e Serviços → Tela de consentimento OAuth**: tipo "Externo", preencha nome do app e e-mail de suporte.
3. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo "Aplicativo da Web".
4. Em **Origens JavaScript autorizadas**, adicione a URL do seu projeto Supabase, por exemplo `https://SEU_PROJETO.supabase.co`.
5. Em **URIs de redirecionamento autorizados**, adicione `https://SEU_PROJETO.supabase.co/auth/v1/callback`.
6. Copie o **Client ID** e o **Client Secret** gerados.

**No Supabase:**

1. **Authentication → Providers → Google**: habilite, cole o Client ID e o Client Secret, salve.
2. **Authentication → URL Configuration → Redirect URLs**: adicione a URL onde o app está publicado (ex: `https://SEU_USUARIO.github.io/gym-tracker/`), senão o Supabase recusa o redirecionamento de volta ao app.

### 5. (Opcional) IA que sugere exercícios e variações

A aba "🤖 IA" analisa seu histórico de treinos e sugere exercícios novos, variações e técnicas de intensidade (drop set, rest-pause etc), usando a API da Claude. Como o app não tem servidor próprio, essa chamada passa por uma **Supabase Edge Function** (`supabase/functions/analyze-workouts`) — assim a chave da API fica protegida no servidor, nunca exposta no navegador.

**1. Pegue uma chave de API da Anthropic:**

Crie uma conta em [console.anthropic.com](https://console.anthropic.com), gere uma API key em **API Keys** e guarde-a (começa com `sk-ant-`).

**2. Instale a Supabase CLI e faça login:**

```sh
npm install -g supabase
supabase login
```

**3. Vincule seu projeto** (rode dentro da pasta do repositório; o project ref aparece na URL do painel Supabase, ex: `npmqjbyizquffmgblivs`):

```sh
supabase link --project-ref SEU_PROJECT_REF
```

**4. Configure a chave da Anthropic como segredo do projeto:**

```sh
supabase secrets set ANTHROPIC_API_KEY=sk-ant-SUA_CHAVE_AQUI
```

**5. Publique a função:**

```sh
supabase functions deploy analyze-workouts
```

Pronto — a partir daí o botão "🔍 Analisar meus treinos" no app já funciona. É preciso ter pelo menos 3 treinos registrados para a análise funcionar. As sugestões ficam salvas no seu perfil (Supabase) e aparecem de novo ao reabrir a aba, sem precisar reanalisar toda vez.

**Custo:** a função usa `claude-haiku-4-5`, o modelo mais barato da Claude ($1 por milhão de tokens de entrada, $5 de saída) — cada análise custa uma fração de centavo (bem menos de US$ 0,01). Não existe um tier gratuito permanente na API da Anthropic, mas contas novas costumam vir com créditos iniciais para teste; confira em [console.anthropic.com](https://console.anthropic.com) → Billing. Se quiser mudar o modelo, edite a constante `MODEL` em `supabase/functions/analyze-workouts/index.ts` e rode `supabase functions deploy analyze-workouts` de novo.

**Limite de uso:** para evitar gasto por cliques repetidos, a função só permite uma nova análise a cada `MIN_INTERVAL_MINUTES` (60 minutos por padrão) — tentativas antes disso são bloqueadas sem chamar a API. O botão no app já reflete esse cooldown. Ajuste a constante no início do arquivo da função se quiser um intervalo diferente.

### 6. (Opcional) Dashboard de admin — só pra você

Existe uma segunda Edge Function, `supabase/functions/admin-dashboard`, que mostra quem está cadastrado no app e alguns dados de uso de cada pessoa (treinos registrados, sequência atual, peso corporal, fotos de treino). Só o e-mail configurado como admin consegue acessar — a checagem acontece no servidor, então mesmo alterando o código do app no navegador ninguém mais consegue ver essa tela.

Diferente da função de IA, esta **não chama nenhuma API paga** — só lê o próprio banco do Supabase, então não tem custo além do que o plano gratuito do Supabase já cobre.

**1. Configure o seu e-mail como admin:**

```sh
supabase secrets set ADMIN_EMAIL=seu-email@exemplo.com
```

Use o mesmo e-mail com que você faz login no app. Troque também a constante `ADMIN_EMAIL` no início do `<script>` do `index.html` (é só o que decide se o botão aparece pra você — a segurança de verdade é a checagem no servidor acima).

**2. Publique a função:**

```sh
supabase functions deploy admin-dashboard
```

Pronto — um ícone 🛠️ aparece no topo da tela inicial só quando você estiver logado com o e-mail configurado, abrindo a lista de usuários cadastrados.

**Privacidade:** essa função enxerga dados de todo mundo que se cadastrar no app, incluindo peso corporal e fotos de treino — não tem como restringir por usuário. Só ative se você é o único administrador de confiança, e avise quem for testar o app que você (o dono do projeto) tem acesso a esses dados.

### 7. Abrir o app

Abra `index.html` diretamente no navegador, ou publique a pasta em qualquer serviço de hospedagem estática.

### 8. Instalar no celular como app (PWA)

O app já é instalável — precisa estar publicado num link `https://` (GitHub Pages, por exemplo; não funciona abrindo o arquivo local).

- **Android (Chrome)**: abra o link, toque no menu (⋮) → "Adicionar à tela inicial" ou "Instalar app".
- **iPhone (Safari)**: abra o link, toque no botão de compartilhar (□↑) → "Adicionar à Tela de Início".

Depois disso o app abre com ícone próprio, em tela cheia, sem a barra do navegador — como um app nativo. Login, treinos e IA continuam precisando de internet (dependem do Supabase), mas o app abre instantaneamente mesmo com conexão ruim.

## Funcionalidades

- Login e cadastro com e-mail e senha, e login com Google (Supabase Auth), dados sincronizados entre dispositivos
- Registro rápido de treino: grupo muscular, exercício, séries (peso e repetições), sensação após o treino
- Base de 34 exercícios pré-carregados em 7 grupos musculares (peito, costas, perna, ombro, braço, core e cardio), cada um com ícone SVG — inclui cadeira abdutora, cadeira adutora, barra fixa, afundo e outros
- Variação do exercício (ex: "pegada aberta", "halteres") como especificação selecionável em chips, não como comentário livre
- Corrida na esteira como exercício de cardio/aquecimento, registrada em distância (km) e tempo (min) em vez de peso e repetições
- Histórico agrupado por dia de treino
- Dashboard com filtros: treinos por mês, por grupo muscular, evolução de peso por exercício (gráficos SVG feitos à mão)
- Sequência de dias treinados (streak) 🔥
- Metas semanais configuráveis com acompanhamento de progresso
- Bloqueio de registro de treino em datas futuras
- Cronômetro de descanso ao vivo durante o registro do treino (presets, ajuste, som e vibração)
- IA que analisa o histórico de treinos e sugere grupo muscular a treinar, exercício novo, variação, progressão (ou redução) de carga e técnicas de intensidade — com explicação simples dos termos direto no app
- Metas semanal, mensal e de peso corporal, com registro de peso e gráfico de evolução
- Botão para abrir uma busca de imagens do exercício no navegador, pra conferir a execução correta
- Foto opcional ao concluir o treino, guardada com segurança (bucket privado, só você acessa)
- Histórico clicável: toque num dia pra ver o resumo completo do treino e a foto, se registrada
- Instalável como app no celular (PWA) — ícone na tela de início, abre em tela cheia, sem navegador
- Editar ou excluir um treino já registrado, direto pelo detalhe do dia
- Recordes pessoais e volume total de treino (peso × séries × repetições) em Histórico → Métricas
- Conquistas/selos desbloqueados automaticamente com base no seu histórico (aba Metas → Selos)
- Exercícios personalizados: adicione os seus próprios além dos 23 pré-carregados
- Modelos de treino (rotina A/B/C): monte uma sequência de exercícios e inicie o treino inteiro com um toque, avançando automaticamente entre eles
- Exportar todo o histórico de treinos em CSV
- Lembrete para treinar (notificação local, aparece quando você abre o app — não é push em segundo plano)
- Dashboard de admin (opcional, só para o dono do app): lista quem está cadastrado e dados de uso de cada pessoa

## Stack

HTML, CSS e JavaScript puro em um único arquivo (`index.html`), sem framework e sem build. Autenticação e persistência de dados via [Supabase](https://supabase.com) (Postgres + Auth), carregado via CDN (`@supabase/supabase-js`). Sugestões por IA via [Supabase Edge Function](supabase/functions/analyze-workouts) chamando a API da Claude (Anthropic).

## Pendências para a próxima fase

- Bloqueio de outros apps durante o treino (restrições fortes no iOS)
