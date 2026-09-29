# Conecta — comunicação interna da Tríade

Base inicial da aplicação interna do escritório, com foco em comunicação rápida, avisos, lembretes e canais por setor.

## Estado atual

- `index.html`: aplicação navegável e responsiva.
- Tela de login com Firebase Authentication por e-mail e senha.
- Recuperação de senha por e-mail.
- Encerramento de sessão pelo perfil do usuário.
- Inicialização do Firebase App, Analytics, Authentication e Firestore.
- `data/seed.json`: dados iniciais genéricos para demonstração.
- `docs/architecture.md`: arquitetura funcional e plano de evolução.
- `public/conecta-prototipo.html`: cópia de referência da versão anterior.

O protótipo ainda mantém avisos, conversas e lembretes locais no navegador. A próxima camada substitui esse armazenamento por dados compartilhados no Firestore.

## Firebase Hosting

O arquivo `firebase.json` já está preparado para publicar a aplicação como site estático. Para publicar, instale o Firebase CLI, faça login e associe o projeto:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --project triadechat --only hosting
```

O projeto está associado ao Firebase `triadechat`. As regras iniciais do Firestore permitem acesso somente a usuários autenticados; as permissões por setor serão refinadas no backend.

## Como abrir

Abra `index.html` no navegador. Para testar o login, é necessário habilitar o provedor “E-mail/senha” no Firebase Authentication e criar um usuário no console do Firebase.

## Próxima implementação

1. Perfis de funcionário e setores no Firestore.
2. Conversas e mensagens compartilhadas.
3. Avisos e lembretes sincronizados.
4. Permissões por setor.
5. Atualização em tempo real e notificações.
