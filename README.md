# Conecta — comunicação interna da Tríade

Base inicial da aplicação interna do escritório, com foco em comunicação rápida, avisos, lembretes e canais por setor.

## Estado atual

- `index.html`: aplicação navegável e responsiva.
- `data/seed.json`: estrutura de setores e permissões, sem usuários fictícios.
- `docs/architecture.md`: arquitetura funcional e plano de evolução.
- Avisos, lembretes, canais e mensagens sincronizados em tempo real pelo Firestore para usuários autenticados.

Conversas por setor criam seus canais no Firestore quando são acessadas pela primeira vez. Mensagens novas são gravadas na subcoleção do canal e carregadas em tempo real.

## Firebase Hosting

O arquivo `firebase.json` já está preparado para publicar a aplicação como site estático. Para publicar, instale o Firebase CLI, faça login e associe o projeto:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting
```

O projeto já está associado ao Firebase `triadechat`. O frontend inicializa Firebase App, Analytics, Authentication e Firestore. As regras iniciais do Firestore permitem acesso somente a usuários autenticados; as permissões por setor serão refinadas junto com o login.

## Publicação automática pelo GitHub

O workflow `.github/workflows/firebase-hosting.yml` publica automaticamente cada alteração enviada para a branch `main`. Para ativá-lo, cadastre no repositório o Secret `FIREBASE_SERVICE_ACCOUNT_TRIADECHAT` com o JSON de uma conta de serviço do projeto Firebase. Depois disso, cada push atualizará o endereço `triadechat.web.app`.

## Como abrir

Abra `index.html` no navegador. Não há dependências obrigatórias para executar a versão atual.

## Próxima implementação

1. Autenticação e perfis de funcionário.
2. API para usuários, setores, conversas, mensagens, avisos e lembretes.
3. Banco compartilhado e controle de permissões.
4. Atualização em tempo real e notificações.
5. Publicação privada para a equipe.

