# Conecta — comunicação interna da Tríade

Base inicial da aplicação interna do escritório, com foco em comunicação rápida, avisos, lembretes e canais por setor.

## Estado atual

- `index.html`: aplicação navegável e responsiva.
- `data/seed.json`: estrutura de setores e permissões, sem usuários fictícios.
- `docs/architecture.md`: arquitetura funcional e plano de evolução.

O protótipo usa `localStorage` para manter os dados no navegador. Isso permite testar a experiência sem servidor. A próxima camada substitui esse armazenamento por uma API e banco compartilhado.

## Firebase Hosting

O arquivo `firebase.json` já está preparado para publicar a aplicação como site estático. Para publicar, instale o Firebase CLI, faça login e associe o projeto:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only hosting
```

O projeto já está associado ao Firebase `triadechat`. O frontend inicializa Firebase App, Analytics, Authentication e Firestore. As regras iniciais do Firestore permitem acesso somente a usuários autenticados; as permissões por setor serão refinadas junto com o login.

## Como abrir

Abra `index.html` no navegador. Não há dependências obrigatórias para executar a versão atual.

## Próxima implementação

1. Autenticação e perfis de funcionário.
2. API para usuários, setores, conversas, mensagens, avisos e lembretes.
3. Banco compartilhado e controle de permissões.
4. Atualização em tempo real e notificações.
5. Publicação privada para a equipe.

