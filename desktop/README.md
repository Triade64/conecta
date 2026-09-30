# Conecta para Windows — versão de teste

O aplicativo abre https://triadecontabilidade.vercel.app e usa a mesma conta e o mesmo banco do Conecta. A primeira execução exige login; a sessão fica no perfil local do aplicativo. As atualizações do site aparecem automaticamente no aplicativo.

Ao receber uma chamada de atenção individual, o aplicativo restaura a janela, solicita foco, abre a conversa e executa o tremor já configurado no site. O Windows pode negar o foco enquanto outro programa está em uso; nesse caso, o ícone pisca na barra de tarefas.

O botão X mantém o aplicativo na bandeja para receber mensagens. Para encerrar, clique com o botão direito no ícone ao lado do relógio e escolha **Sair do Conecta**. Não há inicialização automática com o Windows.

## Instalar a versão de teste

No GitHub, abra **Actions → Conecta para Windows**, entre na execução concluída e baixe o artefato **Conecta-Windows**. Extraia o ZIP e execute **Conecta-Setup-0.1.0-x64.exe**. O instalador de teste não possui assinatura digital; o Windows pode mostrar um aviso de editor desconhecido. É necessário Windows 10/11 de 64 bits e conexão com a internet.

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
