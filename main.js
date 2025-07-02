const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const mime = require('mime-types');

const app = express();
app.use(express.json());

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox']
  }
});

client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
});

client.once('ready', () => {
  console.log('✅ Bot WhatsApp conectado e pronto!');
});

client.initialize();

app.post('/enviar-boleto', async (req, res) => {
  const { numero, artigo, empresa, pdfUrl, digitable, pixKey, amount } = req.body;

  if (!numero || !artigo || !empresa || !pdfUrl || !digitable || !pixKey || !amount) {
    return res.status(400).send('Campos obrigatórios: numero, nome da empresa, artigo, código de barras, chave pix e pdfUrl');
  }

  const chatId = `${numero}@c.us`;
  
  const mensagemPadrao = `Prezado cliente, aqui é ${artigo} *${empresa}* e estamos passando para avisar que seu boleto no valor de ${amount},00 já está pronto. Utilize o código de barras para efetuar o pagamento.`;
  const pix = pixKey;
;
  const codebar = `${digitable}`;
  try {
    const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    const mimeType = mime.lookup(pdfUrl) || 'application/pdf';

    const media = new MessageMedia(mimeType, base64, 'boleto.pdf');

    await client.sendMessage(chatId, mensagemPadrao);
    await client.sendMessage(chatId, codebar);
    await client.sendMessage(chatId, `Se preferir, segue o código de chave pix como alternativa`);
    await client.sendMessage(chatId, pix);
    await client.sendMessage(chatId, media);
    await client.sendMessage(chatId, `Qualquer dúvida, estamos por aqui. 😊`);

    console.log(`📨 Boleto enviado para ${numero}`);
    res.send('✅ Mensagem e PDF enviados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao enviar boleto:', error.message);
    res.status(500).send('Erro ao enviar boleto.');
  }
});

app.post('/enviar-cobranca', async (req, res) => {
  const { numero, artigo, empresa, diasParaVencimento, valor, digitable, pixKey, pdfUrl, dataVencimento } = req.body;

  if (!numero || !artigo || !empresa || !diasParaVencimento || !valor || !digitable || !pixKey || !pdfUrl) {
    return res.status(400).send('Campos obrigatórios: numero, artigo, empresa, valor, digitable, pixKey');
  }

  const pix = pixKey;


  const chatId = `${numero}@c.us`;
  
  try {
    let mensagens = [];
    
    if (diasParaVencimento == 3) {
      mensagens = [
        `🔔 *LEMBRETE DE VENCIMENTO*`,
        ``,
        `Olá ! Aqui é ${artigo} *${empresa}*.`,
        ``,
        `Estamos passando para lembrar que seu boleto no valor de *R$ ${valor}* vence em *3 dias*, no dia *${dataVencimento}*.`,
        ``,
        `Para evitar juros e multas, efetue o pagamento até a data de vencimento.`,
        ``,
        `💳 *Código de barras:*`,
        `${digitable}`,
        ``,
        `🔑 *Chave PIX (alternativa):*`,
        `${pix}`,
        ``,
        `Qualquer dúvida, estamos à disposição! 😊`
      ];
    } else if (diasParaVencimento == 0) {
      mensagens = [
        `⚠️ *VENCIMENTO HOJE*`,
        ``,
        `Olá! Aqui é ${artigo} *${empresa}*.`,
        ``,
        `Seu boleto no valor de *R$ ${valor}* vence *HOJE* (${dataVencimento}).`,
        ``,
        `⏰ Para evitar juros e multas, efetue o pagamento ainda hoje!`,
        ``,
        `💳 *Código de barras:*`,
        `${digitable}`,
        ``,
        `🔑 *Chave PIX (pagamento instantâneo):*`,
        `${pix}`,
        ``,
        `Em caso de dúvidas ou dificuldades, entre em contato conosco. Estamos aqui para ajudar! 📞`
      ];
    } else if (diasParaVencimento == -1) {
      const diasVencido = Math.abs(diasParaVencimento);
      mensagens = [
        `🚨 *BOLETO VENCIDO*`,
        ``,
        `Olá! Aqui é ${artigo} *${empresa}*. Identificamos que seu boleto no valor de *R$ ${valor}* está vencido há *${diasVencido} dia${diasVencido > 1 ? 's' : ''}* (vencimento: ${dataVencimento}).`,
        ``,
        `⚠️ *IMPORTANTE:* Boletos vencidos podem ter juros e multas aplicados.`,
        ``,
        `💳 *Código de barras:*`,
        `${digitable}`,
        ``,
        `🔑 *Chave PIX:*`,
        `${pix}`,
        ``,
        `📞 Para negociar condições de pagamento ou esclarecer dúvidas, entre em contato conosco o quanto antes.`
      ];
    }

    for (const mensagem of mensagens) {
      if (mensagem.trim()) {
        await client.sendMessage(chatId, mensagem);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (pdfUrl) {
      try {
        const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = mime.lookup(pdfUrl) || 'application/pdf';
        const media = new MessageMedia(mimeType, base64, 'boleto.pdf');
        
        await client.sendMessage(chatId, media);
      } catch (pdfError) {
        console.error('❌ Erro ao enviar PDF:', pdfError.message);
      }
    }

    console.log(`📨 Cobrança enviada para ${numero} - ${diasParaVencimento} dias para vencimento`);
    res.json({
      success: true,
      message: 'Cobrança enviada com sucesso!',
      diasParaVencimento: diasParaVencimento,
      tipoCobranca: diasParaVencimento === 3 ? 'lembrete_3_dias' : 
                   diasParaVencimento === 0 ? 'vencimento_hoje' : 
                   diasParaVencimento === -1 ? 'vencido_faz_um_dia' : 'vencido_faz_um_dia'
    });

  } catch (error) {
    console.error('❌ Erro ao enviar cobrança:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erro ao enviar cobrança.',
      error: error.message
    });
  }
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 API do bot rodando em http://localhost:3000');
  console.log('📋 Endpoints disponíveis:');
  console.log('  POST /enviar-boleto - Enviar boleto inicial');
  console.log('  POST /enviar-cobranca - Enviar cobrança baseada no vencimento');
});
