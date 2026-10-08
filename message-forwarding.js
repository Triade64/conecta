(function (root) {
  // Read with the current session so source visibility is enforced by RLS.
  root.conectaForwardMessage = async (user, conversationId, messageId) => {
    const fb = root.conectaFirebase;
    const assertSession = () => {
      if (!user?.id || root.conectaCurrentUser?.id !== user.id) throw new Error("Sua sessão mudou. Entre novamente.");
    };
    assertSession();
    const { data: source, error } = await fb.db.from("messages").select("*").eq("id", messageId).maybeSingle();
    if (error) throw error;
    if (!source || source.deleted_at) throw new Error("Esta mensagem foi apagada ou não está mais disponível.");
    let uploaded = null, path = null;
    try {
      if (source.attachment_path?.startsWith("giphy:")) {
        path = source.attachment_path;
      } else if (source.attachment_path) {
        const isFile = source.attachment_path.startsWith("file:");
        const bucket = isFile ? "chat-files" : "chat-media";
        const storagePath = isFile ? source.attachment_path.slice(5) : source.attachment_path;
        const { data: blob, error: downloadError } = await fb.db.storage.from(bucket).download(storagePath);
        if (downloadError) throw downloadError;
        if (!blob) throw new Error("Não foi possível carregar o anexo.");
        assertSession();
        const file = new File([blob], source.attachment_name || "GIF.gif", { type: source.attachment_mime || blob.type || "image/gif" });
        uploaded = await fb.uploadChatFile(user, conversationId, file);
        path = uploaded.path;
      } else if (source.attachment_url) {
        throw new Error("Este anexo antigo não pode ser encaminhado. Baixe-o e envie como arquivo.");
      }
      assertSession();
      const text = "↪ Mensagem encaminhada\n" + (source.text || "");
      await fb.sendMessage(user, conversationId, text, null, path, null, uploaded?.info || null);
    } catch (failure) {
      if (uploaded) {
        try { await fb.removePendingChatFile(uploaded.path); }
        catch (cleanupError) { console.warn("Could not remove pending forwarded attachment", cleanupError); }
      }
      throw failure;
    }
  };
})(globalThis);
