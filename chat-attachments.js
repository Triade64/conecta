(function (root) {
  const types = { jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',txt:'text/plain',csv:'text/csv',zip:'application/zip',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet' };
  const maxSize = 20 * 1024 * 1024;
  function validate(file) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0) throw Error('Escolha um arquivo que não esteja vazio.');
    if (file.size > maxSize) throw Error('O anexo precisa ter até 20 MB.');
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (!types[extension]) throw Error('Formato não permitido. Use imagens, PDF, Office, texto/CSV ou ZIP.');
    return { name: String(file.name).slice(0,255), mime: types[extension], size: file.size, extension };
  }
  const formatSize = size => size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1,Math.ceil(size / 1024)) + ' KB';
  const api = Object.freeze({ validate, formatSize, accept: Object.keys(types).map(x=>'.'+x).join(','), maxSize });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.conectaAttachments = api;
})(globalThis);
