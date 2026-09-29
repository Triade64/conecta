# Conecta — comunicação interna da Tríade

Base inicial da aplicação interna do escritório, com foco em comunicação rápida, avisos, lembretes e canais por setor.

## Estado atual

- `index.html`: aplicação navegável e responsiva.
- `data/seed.json`: estrutura de setores e permissões, sem usuários fictícios.
- `docs/architecture.md`: arquitetura funcional e plano de evolução.
- Avisos, lembretes, canais e mensagens sincronizados em tempo real pelo Firestore para usuários autenticados.

Conversas por setor criam seus canais no Firestore quando são acessadas pela primeira vez. Mensagens novas são gravadas na subcoleção do canal e carregadas em tempo real.

## Vercel + Supabase

A publicação deve ser feita conectando o repositório `Triade64/conecta` à Vercel. O arquivo `vercel.json` já configura o roteamento da aplicação.

No Supabase, execute `supabase/schema.sql` no SQL Editor. Depois, configure na Vercel as variáveis:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

O frontend usa Supabase Auth, Postgres com RLS e Realtime para perfis, avisos, lembretes, canais e mensagens. A chave `publishable`/`anon` pode ficar no frontend; a `service_role` nunca deve ser publicada.

## Como abrir

Abra `index.html` no navegador. Não há dependências obrigatórias para executar a versão atual.

## Próxima implementação

1. Autenticação e perfis de funcionário.
2. API para usuários, setores, conversas, mensagens, avisos e lembretes.
3. Banco compartilhado e controle de permissões.
4. Atualização em tempo real e notificações.
5. Publicação privada para a equipe.
