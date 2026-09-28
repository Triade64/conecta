# Arquitetura do Conecta

## Módulos funcionais

| Módulo | Responsabilidade |
| --- | --- |
| Identidade | Login, sessão, perfil e permissões do colaborador |
| Conversas | Chat individual, canais por setor e canal geral |
| Avisos | Comunicados, setor de destino, fixação e arquivamento |
| Lembretes | Tarefas pessoais, prazo, conclusão e reabertura |
| Notificações | Mensagens novas, avisos e lembretes próximos do prazo |
| Administração | Usuários, setores, permissões e configurações |

## Entidades previstas

- `users`: colaboradores e perfil de acesso.
- `sectors`: setores e canais disponíveis.
- `conversations`: conversa individual, grupo ou canal.
- `conversation_members`: participantes e permissões da conversa.
- `messages`: conteúdo, autor, data e status de leitura.
- `notices`: comunicados, setor, autor, prioridade e publicação.
- `reminders`: lembretes pessoais ou compartilhados.
- `notifications`: eventos ainda não lidos.

## Rotas de API planejadas

```text
POST   /api/auth/login
GET    /api/me
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages
GET    /api/notices?sector=geral
POST   /api/notices
PATCH  /api/notices/:id
GET    /api/reminders
POST   /api/reminders
PATCH  /api/reminders/:id
GET    /api/notifications
PATCH  /api/notifications/:id/read
```

## Regras iniciais

1. Todo colaborador autenticado pode visualizar o canal Geral.
2. Canais de setor ficam visíveis aos membros daquele setor e administradores.
3. Avisos podem ser publicados para Geral ou para um setor específico.
4. Mensagens individuais só ficam visíveis aos participantes.
5. Lembretes pessoais pertencem ao usuário que os criou.
6. Administradores podem gerenciar usuários, setores e avisos.

