# Treino — Parceiro de Academia

App habit tracker de treino, feito para treinar o uso do Claude. Registra séries, pesos e repetições, acompanha sequência de dias treinados, metas semanais e evolução de peso por exercício.

Agora com **login real via Supabase Auth** — os treinos ficam salvos na nuvem, vinculados à sua conta, e sincronizam entre qualquer dispositivo.

## Como rodar

O app é um único arquivo `index.html`, sem build, sem framework. Basta configurar o Supabase e abrir o arquivo (ou publicar em qualquer hospedagem estática — GitHub Pages, Netlify, Vercel etc).

### 1. Criar o projeto no Supabase

1. Crie uma conta e um projeto em [supabase.com](https://supabase.com) (plano gratuito é suficiente).
2. No painel do projeto, vá em **SQL Editor** → **New query**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e execute. Isso cria as tabelas `profiles` e `workouts` com Row Level Security (cada pessoa só acessa os próprios dados).
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

### 5. Abrir o app

Abra `index.html` diretamente no navegador, ou publique a pasta em qualquer serviço de hospedagem estática.

## Funcionalidades

- Login e cadastro com e-mail e senha, e login com Google (Supabase Auth), dados sincronizados entre dispositivos
- Registro rápido de treino: grupo muscular, exercício, séries (peso e repetições), nota de variação, sensação após o treino
- Base de 23 exercícios pré-carregados em 6 grupos musculares, cada um com ícone SVG
- Sugestões de variação por exercício em chips
- Histórico agrupado por dia de treino
- Dashboard com filtros: treinos por mês, por grupo muscular, evolução de peso por exercício (gráficos SVG feitos à mão)
- Sequência de dias treinados (streak) 🔥
- Metas semanais configuráveis com acompanhamento de progresso
- Bloqueio de registro de treino em datas futuras
- Cronômetro de descanso ao vivo durante o registro do treino (presets, ajuste, som e vibração)

## Stack

HTML, CSS e JavaScript puro em um único arquivo (`index.html`), sem framework e sem build. Autenticação e persistência de dados via [Supabase](https://supabase.com) (Postgres + Auth), carregado via CDN (`@supabase/supabase-js`).

## Pendências para a próxima fase

- Bloqueio de outros apps durante o treino (restrições fortes no iOS)
- IA que analisa o histórico de treinos e sugere exercícios, variações e métodos como drop set
