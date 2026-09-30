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

## Configuração da Vercel

Configure as variáveis de ambiente:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

A chave `publishable` pode ser usada no frontend em conjunto com RLS. Nunca publique uma chave `service_role`.
