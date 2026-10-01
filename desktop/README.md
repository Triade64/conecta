# Conecta para Windows — versão de teste

O aplicativo abre https://triadecontabilidade.vercel.app e usa a mesma conta e o mesmo banco do Conecta. A primeira execução exige login; a sessão fica no perfil local do aplicativo. As atualizações do site aparecem automaticamente no aplicativo.

Ao receber uma chamada de atenção individual, o aplicativo restaura a janela, solicita foco, abre a conversa e executa o tremor já configurado no site. O Windows pode negar o foco enquanto outro programa está em uso; nesse caso, o ícone pisca na barra de tarefas.

O botão X mantém o aplicativo na bandeja para receber mensagens. Para encerrar, clique com o botão direito no ícone ao lado do relógio e escolha **Sair do Conecta**. Não há inicialização automática com o Windows.

## Instalar a versão de teste

No GitHub, abra **Actions → Conecta para Windows**, entre na execução concluída e baixe o artefato **Conecta-Windows**. Extraia o ZIP e execute **Conecta-Setup-0.1.2-x64.exe**. O instalador de teste não possui assinatura digital; o Windows pode mostrar um aviso de editor desconhecido. É necessário Windows 10/11 de 64 bits e conexão com a internet.

Teste em dois computadores: entre com usuários diferentes, minimize o aplicativo de um deles e envie uma chamada pelo botão 🔔 do outro. Verifique a restauração, abertura da conversa e tremor. O teste real de foco deve ser feito no Windows; os testes automatizados usam uma janela simulada.

## Desenvolvimento

Com Node.js 22 instalado:

```sh
cd desktop
npm ci
npm test
npm start
npm run dist:win
```

Electron e electron-builder estão fixados no package.json e no lockfile. Conteúdo remoto usa sandbox, contextIsolation e Node integration desativado. A única ponte nativa permite chamar atenção, com verificação do remetente, frame principal, origem HTTPS e identificador da conversa. Há intervalo nativo de 15 segundos. Links externos HTTPS abrem no navegador; esquemas locais e navegação interna para outras origens são bloqueados.

A versão 0.1.2 envia mensagens e lembretes pela API nativa do Windows. Em Meu perfil → Testar notificação, o aplicativo mostra a confirmação ou a falha retornada pelo sistema. As preferências de som e de desativação continuam disponíveis.

## Atualizar pelo aplicativo

Use Conecta → Verificar atualizações ou a mesma opção no ícone perto do relógio. O aplicativo também verifica ao abrir e a cada quatro horas. Ele pede autorização para baixar e depois para reiniciar e instalar. Fechar pelo X mantém o aplicativo na bandeja; uma atualização baixada só é instalada ao escolher Reiniciar e instalar.

A versão 0.1.2 é a primeira com atualização integrada e precisa ser instalada uma vez. As próximas versões são publicadas em GitHub Releases com o instalador, blockmap e latest.yml. Para publicar uma nova versão nativa, aumente a versão em desktop/package.json e atualize package-lock.json antes do push. O workflow preserva releases já publicadas; mudanças do site aparecem ao recarregar a conversa.

A versão 0.1.3 baixa anexos nativamente pelo aplicativo, com a janela Salvar e indicação de progresso na barra de tarefas. Somente URLs assinadas de anexos do projeto Conecta são aceitas; links externos continuam abrindo no navegador. Arquivos salvos não são executados automaticamente. Atualize em Conecta → Verificar atualizações.
