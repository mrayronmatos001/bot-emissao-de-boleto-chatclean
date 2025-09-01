// --- Endpoint /enviar-boleto (VERSÃO DE TESTE) ---
app.post('/enviar-boleto', async (req, res) => {
  console.log(">>> INICIANDO TESTE DE ENDPOINT SEM WHATSAPP <<<");

  if (!whatsappPronto) {
    // Temporariamente, vamos ignorar essa checagem para o teste
    // return res.status(503).send('❌ WhatsApp ainda está conectando. Tente novamente em alguns segundos.');
  }

  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;
  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios ausentes.');
  }

  // --- BLOCO COMENTADO ---
  /*
  let chatId;
  try {
    chatId = await obterChatIdSeguro(numero);
  } catch {
    return res.status(400).send('❌ Número informado não é válido no WhatsApp.');
  }

  const task = async () => {
    try {
      console.log(`[FILA] Iniciando envio de BOLETO para ${chatId}.`);

      const mensagemPrincipal = [
        `📄 *SEU BOLETO CHEGOU*`,
        ``,
        `Olá! Aqui é ${artigo} *${empresa}*.`,
        `Seu boleto no valor de *${amount}* já está disponível para pagamento.`,
        ``,
        `Para facilitar, enviamos abaixo as opções de pagamento.`,
        `Use o código de barras ou a chave PIX para pagar:`,
        ``,
        `Qualquer dúvida, estamos por aqui! 😊`
      ].join('\n');

      await client.sendMessage(chatId, mensagemPrincipal);
      await client.sendMessage(chatId, digitable);
      await client.sendMessage(chatId, pixKey);

      const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
      const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
      await client.sendMessage(chatId, media);

      console.log(`[FILA] Finalizado envio de BOLETO para ${chatId}.`);
    } catch (error) {
      console.error(`❌ Erro no processamento da fila de BOLETO para ${chatId}:`, error);
      throw error;
    }
  };

  processarEnvio(chatId, task).catch(error => {
    console.error(`❌ Falha crítica na execução da fila de BOLETO para ${numero}:`, error.message);
  });
  */
  // --- FIM DO BLOCO COMENTADO ---

  // Envie uma resposta direta para o teste
  console.log(">>> TESTE CONCLUÍDO. O ENDPOINT RESPONDEU. <<<");
  res.status(200).send('✅ Teste de bypass do WhatsApp bem-sucedido.');
});
