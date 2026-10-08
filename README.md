# Conecta — comunicação interna da Tríade

Aplicação web para comunicação por setor e individual, avisos, lembretes e administração da equipe.

## Tecnologias

- Frontend estático em `index.html` e `features.js`.
- Supabase Auth, Postgres com RLS e Realtime em `supabase-app.js`.
- Deploy pela Vercel conectada ao repositório `Triade64/conecta`.

## Banco de dados

Para uma instalação nova, execute os scripts no SQL Editor do Supabase nesta ordem:

1. `supabase/schema.sql`
2. `supabase/sector-permissions.sql`
3. `supabase/direct-messages.sql`
4. `supabase/message-management.sql`
5. `supabase/message-author-identity.sql`
6. `supabase/conversation-unreads.sql`
7. `supabase/admin-content-moderation.sql`
8. `supabase/chat_realtime_security.sql`
9. `supabase/global-announcements-presence.sql`
10. `supabase/profile-photos.sql`
11. `supabase/chat-gif-attachments.sql`
12. `supabase/kitchen-calendar.sql`

## Calendário do escritório

Em **Calendário → Configurar rodízio**, um administrador informa os participantes (um nome por linha), a data de início e quem começa a lavar e a varrer. A lista é ordenada em português. Louça ocorre de segunda a sexta; varrição, às quartas, em um rodízio independente.

Quem seca passa a lavar no próximo dia programado. Se A lava e B falta, C seca; no próximo dia, C lava e D seca. Em **Ajustar dia**, registre ausências, suspenda tarefas em feriados, altere responsáveis ou transfira tarefas para uma data posterior. Dias suspensos e dias sem pessoas suficientes não consomem vez. A transferência substitui as mesmas tarefas do destino; mudanças recalculam a sequência seguinte. Configurar a lista novamente recalcula desde a data de início, mantendo as exceções já registradas.

O calendário é compartilhado entre colaboradores ativos. Somente administradores ativos podem alterá-lo, com RLS no banco e controle de versão para evitar sobrescrever alterações simultâneas. Não há preenchimento automático de feriados. Atualize o calendário para consultar mudanças feitas por outra pessoa.

A escala do café alterna uma turma por dia útil, com início independente em 30/09/2026: Gabriel, Gabriele, Janice e Rose; Klarice, Lucas, Simone e Vitória. Ausências não mudam automaticamente os integrantes. Em Ajustar dia, suspenda o café, selecione outra turma ou transfira as tarefas para uma data posterior.

Validação do rodízio: `node --test tests/kitchen-rotation.test.cjs`.

O script `global-announcements-presence.sql` configura a agenda de avisos globais, imagens privadas e presença. As imagens dos avisos são redimensionadas para WebP no navegador (até 900 KB, com limite do bucket em 1 MiB) e podem ser programadas por data. `profile-photos.sql` cria fotos privadas de perfil em WebP (até 300 KB). `chat-gif-attachments.sql` habilita GIFs animados privados de até 8 MB no chat, incluindo colagem pelo painel do Windows `Win + .`. Lembretes permanecem privados para cada usuário, inclusive para administradores.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores. O `.env` fica fora do Git; o modelo contém apenas exemplos. O frontend lê a configuração gerada por `npm run build`, não lê o arquivo `.env` diretamente.

```text
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_GIPHY_API_KEY=...
```

As três variáveis acima são **públicas** e aparecem no navegador. GIPHY é opcional. Para instalações antigas, `VITE_SUPABASE_ANON_KEY` é aceito como alternativa à chave publishable. O build rejeita chaves `sb_secret_` e JWT com role `service_role` nesse campo.

`SUPABASE_SERVICE_ROLE_KEY`, senhas e credenciais administrativas são exclusivas do servidor. O Conecta atual usa a sessão do usuário e RLS, portanto não precisa de chave administrativa. O build inclui apenas os três campos públicos e nunca copia `.env`, backend, testes, banco de dados ou documentação para o site.

Execute `npm run build` e sirva a pasta `dist/` para desenvolvimento. Não sirva a raiz do repositório. Validação: `npm run test:config`.

## Configuração da Vercel

Em **Project → Settings → Environment Variables**, configure `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e, se usar a biblioteca de GIFs, `VITE_GIPHY_API_KEY`. Habilite os ambientes Production e Preview e faça um novo deploy. As variáveis da Vercel têm prioridade sobre o `.env` local.

O `vercel.json` executa `npm run build` e publica somente `dist/`. A configuração do Firebase Hosting também aponta para `dist/`, caso seja usado novamente. A configuração antiga do Firebase que estava desativada no HTML foi removida.

Nunca use prefixos `VITE_`/`NEXT_PUBLIC_` para segredos nem coloque `service_role` no cliente. As permissões continuam sendo aplicadas pelo Supabase com RLS.
