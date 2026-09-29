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

O último script configura a agenda de vários avisos globais, imagens privadas e políticas de presença. As imagens dos avisos são redimensionadas e convertidas para WebP no navegador antes do envio; o aplicativo limita o arquivo otimizado a 900 KB e o bucket a 1 MiB. É possível programar início e fim da exibição. Lembretes permanecem privados para cada usuário, inclusive para administradores.

## Configuração da Vercel

Configure as variáveis de ambiente:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

A chave `publishable` pode ser usada no frontend em conjunto com RLS. Nunca publique uma chave `service_role`.
