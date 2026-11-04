# Fluxo de Processos — implementação e homologação

**Status: preparado para revisão; não aplicado à produção.** A branch `feat/fluxo-processos` inclui a interface, a migração e os testes. Nenhuma migração deste módulo deve ser executada no projeto de produção sem autorização.

## Arquitetura encontrada

O Conecta usa `index.html` e módulos JavaScript sem framework, com funções de renderização estendidas pelos módulos. `supabase-app.js` mantém autenticação, sincronização e acesso ao Supabase. O aplicativo Windows carrega o mesmo site. `profiles` contém papel, setor e situação ativa. Os lembretes existentes em `reminders` são individuais; não havia tabela de atividades ou motor intersetorial no banco consultado.

A implementação adiciona um módulo independente e mantém os dados existentes:

| Componente | Responsabilidade |
| --- | --- |
| `workflow-api.js` | Cliente Supabase com RPCs e consultas paginadas |
| `workflow-ui.js` / `workflow.css` | Tela, painel, atividades, avisos, formulários, editor visual e recorrências |
| `workflow-models.js` | Exemplo editável do Fator R, rótulos e análise das etapas impactadas |
| `supabase/migrations/*_intersector_workflows.sql` | Persistência, RLS, documentos e transições transacionais |
| `supabase/workflow-scheduler.sql` | Ativação separada do agendador, somente após aprovação do ambiente |

## Funcionamento

O administrador abre **Fluxo de Processos → Modelos → Usar exemplo do Fator R**, revisa o modelo e salva. O exemplo é um modelo de dados editável, não uma regra fixa do motor. Depois, **Novo processo** solicita empresa, competência, prazo de referência opcional, condições e restrição opcional de participantes.

O modelo permite etapas em paralelo: duas etapas podem ter as mesmas dependências, e uma terceira pode depender de ambas. Dependências são sempre um grafo sem ciclos. Uma condição compara um campo do contexto do cliente com um valor configurado. Uma etapa dispensada por condição só libera suas dependentes depois de suas próprias dependências terminarem.

Cada etapa define setor, responsável preferencial opcional, dias de prazo interno após liberação, antecedência ao prazo legal, campos, conferências obrigatórias e tipos de notificação. O prazo efetivo considera o menor entre o prazo interno e o prazo legal ajustado. A indicação de impactos lista as etapas descendentes de uma entrega atrasada ou impedida.

As ações são **Assumir**, **Salvar dados**, **Concluir e encaminhar**, **Devolver para correção**, **Solicitar informação**, **Registrar/Resolver impedimento** e **Reabrir** (somente administrador). Campos e documentos obrigatórios são verificados no servidor. Devolver exige justificativa e uma dependência anterior concluída. Reabrir/devolver invalida as entregas dependentes, inclusive as já concluídas, mantendo seus dados e preservando o estado anterior no histórico. Esses dados devem ser novamente conferidos e entregues.

O processo preserva a versão completa do modelo da sua criação. Editar um modelo cria uma nova versão. As recorrências também apontam para uma versão fixa e podem ser pausadas. São suportados intervalos de 1 a 12 meses, incluindo mensal, bimestral, trimestral e anual. O dia de prazo legal opcional da recorrência se refere à competência, com ajuste para meses mais curtos; não interpreta calendários de obrigações tributárias.

O modelo do Fator R separa orientações iniciais, folha efetiva, memória da apuração e fechamento contábil. Não calcula nem presume o Fator R definitivo e não escolhe regras tributárias. Período, folha, receita e memória são informados e conferidos pelo setor responsável.

## Segurança e consistência

As oito tabelas do módulo têm RLS e acesso direto somente para leitura. As escritas passam por um RPC invoker que chama uma implementação privada com permissões estritas. A implementação verifica o perfil ativo no banco, o acesso ao processo e a autorização do setor a cada comando. Não usa metadados editáveis do JWT para decidir permissões.

Administradores ativos podem gerir todos os processos. Outros usuários acessam processos dos setores participantes; uma lista explícita de participantes pode restringir ainda mais esse acesso. Apenas o setor da etapa (ou administrador) pode operá-la. A execução exige que o usuário assuma a atividade ou esteja atribuído a ela. O histórico e os dados entregues são compartilhados somente com participantes autorizados do processo.

O banco bloqueia a linha do processo durante uma transição e confere sua revisão. A combinação de UUID de comando e processo impede encaminhamentos duplicados após uma resposta perdida. A interface preserva o UUID para repetir a mesma ação com falha; alterações no formulário constituem um novo comando. Conflitos solicitam recarregamento explícito, sem substituir silenciosamente o formulário aberto.

Documentos ficam no bucket privado `workflow-files`, com limite de 25 MB, caminhos segregados por processo/etapa/usuário e URLs de download de 60 segundos. A publicação do documento é registrada por RPC após o upload. Arquivos registrados não podem ser substituídos nem apagados pela aplicação. Um upload cujo registro falhou permanece inacessível até ser registrado; uma rotina de limpeza de uploads abandonados pode ser adicionada depois, sem remover documentos auditados.

## Atividades, avisos e indicadores

Uma etapa liberada aparece na lista de atividades e nos lembretes compartilhados do setor, disponíveis na tela de Lembretes. Os lembretes pessoais existentes continuam independentes. O dashboard inclui um resumo com acesso ao processo. O histórico exibe usuário, data, origem, destinos, dados entregues, justificativas e os dados anteriores preservados.

Os avisos são uma caixa de entrada persistente por setor com leitura individual, criada na mesma transação da movimentação. Notificações do Windows/navegador seguem a preferência existente no perfil. Falhas ou bloqueios de entrega no sistema operacional não apagam o aviso. Usuários offline encontram os avisos na próxima abertura; o aplicativo não implementa Web Push com o navegador totalmente fechado.

O Realtime invalida o resumo após movimentações e novos avisos. Há recuperação ao retornar à página e verificação a cada cinco minutos enquanto visível. As consultas de processos e histórico têm paginação; indicadores são agregados no servidor sobre todos os processos autorizados, independentemente da página atual. O editor aberto não é substituído automaticamente por atualizações.

Indicadores: processos com ação liberada por setor, processos em correção, etapas atrasadas, processos concluídos dentro de todos os prazos internos e do prazo legal quando informado, e espera média entre a liberação e a aceitação da etapa em transferências entre setores. A média usa a execução atual das etapas; uma reabertura inicia uma nova espera. Não confundir espera para assumir com tempo total de execução.

## Homologação sem produção

1. Use um projeto Supabase de teste com a estrutura atual do Conecta e usuários de teste Fiscal, DP, Contábil e administrador. Nunca aponte o teste destrutivo para a base real.
2. Aplique somente nesse ambiente `supabase/migrations/*_intersector_workflows.sql`. O diretório de migrations deste repositório não representa todo o histórico anterior: não executar um reset de produção a partir dele.
3. Configure o preview com a URL e a chave pública do ambiente de teste. Nenhuma chave privilegiada deve ser usada no frontend.
4. Aplique `supabase/workflow-scheduler.sql` no ambiente de teste para ativar recorrências e avisos de prazo. O job executa a cada cinco minutos no servidor, mesmo sem usuários conectados. O critério de abertura usa a data de São Paulo. Consultar `cron.job_run_details` para falhas; recorrências exibem também a última falha em sua própria tela. O motor tenta novamente no próximo ciclo e isola falhas por recorrência.
5. Crie o exemplo pela interface e execute Fiscal → DP → Fiscal → Contábil, devolvendo uma vez ao Fiscal. Confira documentos obrigatórios, impedimentos, histórico, avisos por setor, restrição de participantes e indicadores.
6. Crie um modelo com etapas paralelas e condicionais pelo editor. Confira que uma junção aguarda todas as dependências e que a edição do modelo não altera processos já abertos.
7. Revise os advisors de segurança e performance do ambiente de teste, as políticas de Storage e a publicação Realtime. Os testes locais conferem RLS, grants e ausência de funções públicas SECURITY DEFINER; não substituem a verificação da configuração do serviço hospedado.
8. Produção: aplicar migração, configurar agendador e integrar a branch somente depois da autorização explícita. Sem a migração, a interface informa que o ambiente ainda não recebeu o módulo.

Não foi provisionada uma base hospedada de teste que gere custos. A validação de banco foi feita com PostgreSQL embarcado (PGlite), incluindo papéis e RLS. A validação de navegador executa a interface real com esse banco; o transporte Supabase/Realtime e o Storage hospedado precisam da etapa de homologação acima.

## Testes reproduzíveis

```sh
npm ci
npm test
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test npm run build
```

A suíte inclui os 57 testes anteriores e 35 cenários de banco no arquivo `tests/workflows-db.test.cjs` (o Node conta esse arquivo como um teste de integração). Nenhum cliente ou usuário real é modificado.

O teste de navegador usa Playwright e Chromium fornecidos pelo ambiente:

```sh
PLAYWRIGHT_MODULE=/caminho/para/playwright CHROMIUM_PATH=/caminho/para/chromium node tests/workflows-browser.cjs
```

Ele cria o modelo pela interface, executa o fluxo inteiro com mudança de usuário/setor, devolução, bloqueio de campos ausentes e dois anexos. Confere também o painel em 1366×768, 1024×600, 768×600 e 390×844, e o editor no tema escuro em tela pequena. As chamadas de dados são substituídas por uma ponte de teste para o PostgreSQL local: não há mensagens nem uploads reais.
