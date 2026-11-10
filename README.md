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
13. `supabase/tasks.sql` (fluxo de tarefas entre setores)
14. `supabase/tasks-sector-aliases.sql`
15. `supabase/tasks-open-templates.sql`
16. `supabase/sectors-standard.sql` (padroniza nomes de setor em perfis, modelos e tarefas)
17. `supabase/tasks-assign-recurring.sql` (responsável, avisos e tarefas recorrentes; requer pg_cron)
18. `supabase/tasks-step-deadlines.sql` (prazo por etapa e feriados)
19. `supabase/tasks-recurrence-competence.sql` (competência da recorrência)
20. `supabase/tasks-competence.sql` (competência como campo da tarefa)
21. `supabase/tasks-deadline-from-competence.sql` (prazos contados do mês seguinte à competência)
22. `supabase/tasks-completion-date.sql` (alterar a data de conclusão)
23. `supabase/tasks-step-done-date.sql` (data de conclusão de cada etapa ao repassar)
24. `supabase/chat-reactions-pins.sql` (reações e mensagens fixadas nas conversas)
25. `supabase/chat-reactions-any-emoji.sql`
26. `supabase/performance-indexes-policies.sql`

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

## Canais personalizados

Em **Administração → Canais e membros → Criar canal**, informe o nome e selecione os colaboradores ativos. Em **Gerenciar membros**, adicione/remova participantes ou renomeie o canal. O criador permanece como membro; administradores participantes podem gerenciar o canal. Outros administradores também precisam ser adicionados para acessar o canal.

Os canais personalizados aparecem na lateral, em Conversas e como destino em Nova mensagem/Encaminhar. Os canais de setor continuam com suas permissões atuais. A migração `supabase/managed-channels.sql` deve ser aplicada depois dos scripts existentes. As políticas restringem mensagens, anexos e pontos de leitura aos membros, inclusive para administradores. A verificação SQL `tests/managed-channels.rls.sql` cria fixtures apenas dentro de uma transação que termina em rollback.

Os participantes da louça (lavar e secar) e da varrição são configurados em listas separadas em **Calendário → Configurar rodízio**. Cada lista segue sua própria ordem alfabética; a louça exige pelo menos duas pessoas e a varrição pode ter uma. Deixar uma lista vazia desativa a tarefa. Configurações antigas mantêm os participantes atuais até o administrador editar as listas. As turmas do café continuam independentes. Em Ajustar dia, as opções de substituição respeitam a lista da tarefa.

## Tarefas entre setores

A aba **Tarefas** controla o fluxo de uma atividade, para um cliente, entre setores. Qualquer colaborador ativo cria tarefas; cada tarefa pertence a um cliente e segue um **modelo de fluxo**: uma sequência de etapas, cada uma com um setor (por exemplo, Atendimento → Fiscal → Contábil).

- **Modelos de fluxo** (qualquer colaborador cria; editar ou inativar é de quem criou ou de administradores; botão *Modelos de fluxo*): informe o nome da atividade e adicione as etapas na ordem do fluxo, escolhendo o setor na lista oficial (Dpto. Fiscal, Dpto. Contábil, Dpto. Pessoal, Administrador) uma descrição opcional e o **prazo da etapa** (dia do mês, de 1 a 31); use ↑ ↓ para reordenar. Variações como "Fiscal" ou "Departamento Fiscal" são tratadas como o mesmo setor. A tarefa copia a sequência ao ser criada; editar o modelo depois não altera tarefas em andamento.
- **Competência**: ao criar uma tarefa, informe a competência (mês/ano); a tela sugere o mês anterior. As recorrências preenchem a competência sozinhas. Ela aparece na lista ("Comp. 10/2026") e no detalhe, e a busca encontra por ela.
- **Prazos por etapa**: não há prazo geral da tarefa. Ao criar a tarefa, cada etapa com prazo recebe a próxima data com aquele dia a partir do **mês seguinte à competência** (competência 10/2026 → prazos em novembro/2026; sem competência, a partir da criação) (dia 31 em mês curto vale o último dia), nunca antes do prazo da etapa anterior; se o dia da etapa seguinte for menor, ela vai para o mês seguinte. Prazo em sábado, domingo ou feriado passa para o próximo dia útil. Atrasos, filtros e o resumo usam o prazo da **etapa atual**. Os prazos são fixados na criação; mudar o modelo ou os feriados depois não altera tarefas existentes.
- **Feriados** (administradores, botão *Feriados*): já vêm cadastrados os nacionais de 2026 e 2027. Inclua Carnaval, feriados estaduais e municipais e os anos seguintes.
- **Etapa concluída em**: ao repassar ou concluir, informe o dia em que a sua etapa foi concluída (padrão: hoje; não pode ser futura nem anterior à criação). A trilha mostra "feita em dd/mm" (em vermelho se passou do prazo da etapa) e o histórico registra a data. Na última etapa, essa data vira a data de conclusão da tarefa.
- **Data de conclusão**: numa tarefa concluída, o criador ou um administrador pode corrigir a data em que ela foi concluída (não pode ser futura nem anterior à criação). A alteração fica no histórico.
- **Andamento**: somente o setor da etapa atual (ou um administrador) pode **repassar** para a próxima etapa ou **devolver** à anterior com motivo. Repassar na última etapa conclui a tarefa. O criador ou um administrador pode **cancelar** com motivo. Quem enxerga a tarefa pode comentar. Cada movimentação fica no histórico, com autor e horário.
- **Visões**: *Minha caixa* (tarefas abertas que você assumiu), *Do meu setor* (tarefas que já chegaram ao seu setor: na sua etapa ou que já passaram por ela), *Enviadas por mim* e *Todas* (somente administradores), com filtros por situação, etapa, prioridade, competência, atraso e busca por cliente ou título. O contador no menu mostra a caixa do seu setor.
- **Responsável**: na tarefa, quem é do setor da vez clica em **Assumir**; o nome aparece na lista e no detalhe. O responsável (ou um administrador) pode **Liberar**. Ao repassar, devolver ou encerrar, a tarefa volta a ficar sem responsável.
- **Avisos**: quando uma tarefa chega à vez do seu setor por ação de outra pessoa (ou pela recorrência), o Conecta mostra uma notificação do Windows/navegador, se ativada, ou um aviso na tela.
- **Visão geral**: a faixa *Tarefas do seu setor* mostra quantas estão na caixa, atrasadas, vencendo hoje e com você, além das próximas três.
- **Recorrências** (botão *Recorrências*): cada colaborador cadastra as suas (cliente, fluxo, título, dia do mês de 1 a 28 e prioridade; os prazos vêm das etapas do fluxo, contados a partir do dia em que a tarefa é criada). Todo dia às 6h (Brasília) o banco cria as tarefas do mês cujo dia já chegou, uma vez por mês. Escolha a **competência**: *mês anterior* (padrão, para o trabalho retroativo) ou *mês atual*. Use `{mes}` (ou `{competencia}`) no título para incluir a competência: "Pró-labore {mes}" criado em novembro vira "Pró-labore 10/2026" com mês anterior, ou "11/2026" com mês atual. Os prazos das etapas continuam contados a partir do dia em que a tarefa é criada. Se o dia já passou quando a recorrência é criada, a primeira tarefa sai no mês seguinte.
- **Clientes**: escolha na lista ou use *Novo cliente* ao criar a tarefa (nome e CNPJ/CPF opcional). Ainda não há tela para editar ou inativar clientes; administradores já têm essa permissão no banco.
- **Segurança**: as tabelas só aceitam leitura direta; todas as mudanças passam pelas funções `task_create`, `task_advance`, `task_return`, `task_cancel` e `task_comment`, que validam setor, sequência e versão (alterações simultâneas são recusadas). Visibilidade: criador, setores que participam do fluxo e administradores. As atualizações chegam em tempo real.

Validação: `node --test tests/tasks-flow.test.cjs` (lógica) e `tests/tasks.rls.sql` (permissões e fluxo no banco; roda em transação com rollback e exige um administrador e quatro outros perfis ativos).

## Links e colagem no chat

Cole textos, links e dados de planilhas com Ctrl+V. O chat preserva quebras de linha e tabulações, sem importar scripts ou estilos dos programas de origem. Endereços HTTP/HTTPS e www ficam clicáveis nas mensagens; links abrem em outra guia no navegador. Imagens copiadas continuam disponíveis como anexo, enquanto tabelas copiadas são inseridas como texto. Enter envia e Shift+Enter insere uma quebra de linha.

## Emojis no chat

O botão 😀 abre 748 emojis Unicode em nove categorias: Mais usados, Carinhas e emoções, Gestos e pessoas, Corações e celebrações, Trabalho e objetos, Comidas e bebidas, Animais e natureza, Viagens e atividades e Símbolos e sinais. Troque a categoria no seletor acima dos emojis. Os emojis são inseridos no cursor, preservando o rascunho. O painel tem rolagem própria e se ajusta à área da conversa.

## Redução de tráfego do Supabase

O chat carrega as últimas 50 mensagens e oferece **Carregar mensagens anteriores** no topo da conversa. A paginação usa data e ID para não duplicar nem pular mensagens com o mesmo horário. Novos eventos consultam apenas os IDs alterados, sem baixar todo o histórico. Buscar uma mensagem antiga ou abrir um favorito carrega uma janela limitada ao redor do registro; **Voltar às mensagens recentes** retorna ao fim da conversa.

As atualizações de cada tabela recarregam somente os dados relacionados, agrupando eventos próximos. O agendamento dos avisos é avaliado localmente a cada minuto. Para colaboradores, uma consulta leve de IDs e versões detecta avisos que ficaram visíveis por horário; o texto e as imagens só são recuperados quando essa lista muda. Uma sincronização de recuperação ocorre ao reconectar, ao voltar ao aplicativo (com intervalo mínimo de um minuto) e a cada cinco minutos enquanto visível. A troca de conta limpa o estado da sessão. Alterações de perfil fazem uma recuperação completa das permissões.

URLs assinadas de anexos e avisos são reutilizadas em memória durante sua validade, com margem para renovação. Fotos e GIFs também reaproveitam resultados. Os arquivos continuam privados; as consultas continuam sujeitas a RLS e não foi alterada nenhuma política no banco. `supabase/efficient-sync-realtime.sql` habilita eventos das fotos e dos avisos globais na publicação Realtime. As otimizações reduzem transferências futuras, sem apagar mensagens ou diminuir o volume já contabilizado no ciclo atual.

Validação: `node --test tests/*.test.cjs` inclui paginação, eventos incrementais, reconexão, isolamento de sessão, filas de atualização e cache.
