const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');

// Schema Database
const transactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['masuk', 'keluar', 'belanja'], required: true },
  item: { type: String, required: true },
  amount: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  date: { type: Date, default: Date.now },
  phone: { type: String, required: true },
  description: { type: String, default: '' }
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Koneksi MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/warung';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Database connected'))
  .catch(err => console.log('❌ Database error:', err));

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: { level: 'silent' }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 Scan QR Code ini dengan WhatsApp:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('🎉 Bot WhatsApp berhasil terhubung!');
            console.log('📱 Bot siap menerima pesan...');
            
            // Kirim pesan selamat datang ke diri sendiri
            setTimeout(async () => {
                const botNumber = sock.user?.id.replace(':0', '@s.whatsapp.net');
                await sock.sendMessage(botNumber, { 
                    text: '🤖 Bot Warung Pecel Lele ONLINE!\n\nKetik /help untuk melihat perintah yang tersedia.' 
                });
            }, 2000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || 
                    msg.message.extendedTextMessage?.text || 
                    msg.message.imageMessage?.caption || '';
        const from = msg.key.remoteJid;
        
        console.log(`📨 Pesan dari ${from}: ${text}`);
        await handleMessage(sock, from, text);
    });
}

async function handleMessage(sock, from, text) {
    const args = text.trim().split(' ');
    const command = args[0].toLowerCase();

    try {
        switch(command) {
            case '/start':
            case '/help':
                await sendHelp(sock, from);
                break;
            case '/masuk':
                await handlePemasukan(sock, from, args);
                break;
            case '/keluar':
                await handlePengeluaran(sock, from, args);
                break;
            case '/belanja':
                await handleBelanja(sock, from, args);
                break;
            case '/laporan':
                await handleLaporan(sock, from, args[1] || 'harian');
                break;
            case '/untung':
                await handleUntung(sock, from);
                break;
            case '/menu':
                await sendMenu(sock, from);
                break;
            case '/hapus':
                await handleHapus(sock, from);
                break;
            default:
                if (text.startsWith('/')) {
                    await sock.sendMessage(from, { 
                        text: '❌ Perintah tidak dikenali.\nKetik /help untuk melihat daftar perintah.' 
                    });
                }
        }
    } catch (error) {
        console.error('Error handling message:', error);
        await sock.sendMessage(from, { 
            text: '❌ Terjadi kesalahan. Silakan coba lagi atau hubungi admin.' 
        });
    }
}

async function handlePemasukan(sock, from, args) {
    if (args.length < 3) {
        await sock.sendMessage(from, { 
            text: '❌ Format salah!\n\n📝 Contoh:\n/masuk ayam-goreng 15000 2\n/masuk lele-bakar 12000 1\n\nFormat: /masuk [item] [harga] [jumlah]' 
        });
        return;
    }
    
    const item = args[1].replace(/-/g, ' ');
    const harga = parseInt(args[2]);
    const jumlah = parseInt(args[3]) || 1;
    
    if (isNaN(harga) || harga <= 0) {
        await sock.sendMessage(from, { text: '❌ Harga harus berupa angka positif!' });
        return;
    }
    
    const transaction = new Transaction({
        type: 'masuk',
        item: item,
        amount: harga * jumlah,
        quantity: jumlah,
        phone: from,
        description: `Penjualan ${item}`
    });
    
    await transaction.save();
    
    const total = harga * jumlah;
    await sock.sendMessage(from, { 
        text: `✅ PEMASUKAN DICATAT!\n\n📝 Item: ${item}\n🔢 Jumlah: ${jumlah}\n💰 Harga satuan: Rp ${harga.toLocaleString()}\n💵 Total: Rp ${total.toLocaleString()}\n📅 ${new Date().toLocaleString('id-ID')}`
    });
}

async function handlePengeluaran(sock, from, args) {
    if (args.length < 3) {
        await sock.sendMessage(from, { 
            text: '❌ Format salah!\n\n📝 Contoh:\n/keluar gas 25000\n/keluar listrik 100000\n\nFormat: /keluar [item] [jumlah]' 
        });
        return;
    }
    
    const item = args[1].replace(/-/g, ' ');
    const jumlah = parseInt(args[2]);
    
    if (isNaN(jumlah) || jumlah <= 0) {
        await sock.sendMessage(from, { text: '❌ Jumlah harus berupa angka positif!' });
        return;
    }
    
    const transaction = new Transaction({
        type: 'keluar',
        item: item,
        amount: jumlah,
        phone: from,
        description: `Pengeluaran ${item}`
    });
    
    await transaction.save();
    
    await sock.sendMessage(from, { 
        text: `💸 PENGELUARAN DICATAT!\n\n📝 Item: ${item}\n💰 Jumlah: Rp ${jumlah.toLocaleString()}\n📅 ${new Date().toLocaleString('id-ID')}`
    });
}

async function handleBelanja(sock, from, args) {
    if (args.length < 3) {
        await sock.sendMessage(from, { 
            text: '❌ Format salah!\n\n📝 Contoh:\n/belanja lele 200000\n/belanja bumbu 50000\n\nFormat: /belanja [item] [jumlah]' 
        });
        return;
    }
    
    const item = args[1].replace(/-/g, ' ');
    const jumlah = parseInt(args[2]);
    
    if (isNaN(jumlah) || jumlah <= 0) {
        await sock.sendMessage(from, { text: '❌ Jumlah harus berupa angka positif!' });
        return;
    }
    
    const transaction = new Transaction({
        type: 'belanja',
        item: item,
        amount: jumlah,
        phone: from,
        description: `Belanja ${item}`
    });
    
    await transaction.save();
    
    await sock.sendMessage(from, { 
        text: `🛒 BELANJA DICATAT!\n\n📝 Item: ${item}\n💰 Jumlah: Rp ${jumlah.toLocaleString()}\n📅 ${new Date().toLocaleString('id-ID')}`
    });
}

async function handleUntung(sock, from) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const pemasukan = await Transaction.aggregate([
        { $match: { type: 'masuk', phone: from, date: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
    const pengeluaran = await Transaction.aggregate([
        { $match: { type: { $in: ['keluar', 'belanja'] }, phone: from, date: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    
    const totalMasuk = pemasukan[0]?.total || 0;
    const totalKeluar = pengeluaran[0]?.total || 0;
    const untung = totalMasuk - totalKeluar;
    const countMasuk = pemasukan[0]?.count || 0;
    const countKeluar = pengeluaran[0]?.count || 0;
    
    const statusEmoji = untung >= 0 ? '🎉' : '😰';
    const statusText = untung >= 0 ? 'UNTUNG' : 'RUGI';
    
    const message = `📊 LAPORAN KEUNTUNGAN HARI INI\n` +
                   `📅 ${new Date().toLocaleDateString('id-ID')}\n\n` +
                   `💰 Pemasukan: Rp ${totalMasuk.toLocaleString()}\n` +
                   `   └ ${countMasuk} transaksi\n\n` +
                   `💸 Pengeluaran: Rp ${totalKeluar.toLocaleString()}\n` +
                   `   └ ${countKeluar} transaksi\n\n` +
                   `${statusEmoji} ${statusText}: Rp ${Math.abs(untung).toLocaleString()}\n\n` +
                   `📈 Margin: ${totalMasuk > 0 ? ((untung/totalMasuk)*100).toFixed(1) : 0}%`;
    
    await sock.sendMessage(from, { text: message });
}

async function handleLaporan(sock, from, periode) {
    let startDate = new Date();
    let title = '';
    
    switch(periode) {
        case 'harian':
            startDate.setHours(0, 0, 0, 0);
            title = 'HARI INI';
            break;
        case 'mingguan':
            startDate.setDate(startDate.getDate() - 7);
            title = '7 HARI TERAKHIR';
            break;
        case 'bulanan':
            startDate.setMonth(startDate.getMonth() - 1);
            title = '30 HARI TERAKHIR';
            break;
        default:
            startDate.setHours(0, 0, 0, 0);
            title = 'HARI INI';
    }
    
    const transactions = await Transaction.find({
        phone: from,
        date: { $gte: startDate }
    }).sort({ date: -1 });
    
    if (transactions.length === 0) {
        await sock.sendMessage(from, { text: `📊 Tidak ada transaksi untuk periode ${title.toLowerCase()}` });
        return;
    }
    
    const pemasukan = transactions.filter(t => t.type === 'masuk');
    const pengeluaran = transactions.filter(t => t.type !== 'masuk');
    
    const totalMasuk = pemasukan.reduce((sum, t) => sum + t.amount, 0);
    const totalKeluar = pengeluaran.reduce((sum, t) => sum + t.amount, 0);
    const untung = totalMasuk - totalKeluar;
    
    let message = `📊 LAPORAN ${title}\n\n`;
    message += `💰 Total Pemasukan: Rp ${totalMasuk.toLocaleString()}\n`;
    message += `💸 Total Pengeluaran: Rp ${totalKeluar.toLocaleString()}\n`;
    message += `${untung >= 0 ? '🎉' : '😰'} Keuntungan: Rp ${untung.toLocaleString()}\n\n`;
    
    if (pemasukan.length > 0) {
        message += `📈 ITEM TERJUAL:\n`;
        const itemStats = {};
        pemasukan.forEach(t => {
            if (!itemStats[t.item]) {
                itemStats[t.item] = { qty: 0, total: 0 };
            }
            itemStats[t.item].qty += t.quantity;
            itemStats[t.item].total += t.amount;
        });
        
        Object.entries(itemStats).forEach(([item, stats]) => {
            message += `• ${item}: ${stats.qty}x - Rp ${stats.total.toLocaleString()}\n`;
        });
    }
    
    await sock.sendMessage(from, { text: message });
}

async function sendMenu(sock, from) {
    const menuText = `🍽️ MENU WARUNG PECEL LELE\n\n` +
                    `🐟 LELE:\n` +
                    `• Lele Bakar - Rp 12.000\n` +
                    `• Lele Goreng - Rp 10.000\n\n` +
                    `🐔 AYAM:\n` +
                    `• Ayam Bakar - Rp 15.000\n` +
                    `• Ayam Goreng - Rp 13.000\n\n` +
                    `🥤 MINUMAN:\n` +
                    `• Es Teh - Rp 3.000\n` +
                    `• Es Jeruk - Rp 4.000\n` +
                    `• Air Mineral - Rp 2.000\n\n` +
                    `💡 Tips: Gunakan nama menu saat mencatat penjualan\n` +
                    `Contoh: /masuk lele-bakar 12000 2`;
    
    await sock.sendMessage(from, { text: menuText });
}

async function handleHapus(sock, from) {
    const lastTransaction = await Transaction.findOne({
        phone: from
    }).sort({ date: -1 });
    
    if (!lastTransaction) {
        await sock.sendMessage(from, { text: '❌ Tidak ada transaksi untuk dihapus' });
        return;
    }
    
    await Transaction.findByIdAndDelete(lastTransaction._id);
    
    await sock.sendMessage(from, { 
        text: `🗑️ TRANSAKSI DIHAPUS!\n\n📝 ${lastTransaction.item}\n💰 Rp ${lastTransaction.amount.toLocaleString()}\n📅 ${lastTransaction.date.toLocaleString('id-ID')}`
    });
}

async function sendHelp(sock, from) {
    const helpText = `🤖 BOT WARUNG PECEL LELE\n\n` +
                    `📝 PERINTAH UTAMA:\n` +
                    `/masuk [item] [harga] [jumlah] - Catat penjualan\n` +
                    `/keluar [item] [jumlah] - Catat pengeluaran\n` +
                    `/belanja [item] [jumlah] - Catat belanja\n` +
                    `/untung - Keuntungan hari ini\n` +
                    `/laporan [periode] - Laporan (harian/mingguan/bulanan)\n` +
                    `/menu - Lihat daftar menu\n` +
                    `/hapus - Hapus transaksi terakhir\n\n` +
                    `📝 CONTOH PENGGUNAAN:\n` +
                    `/masuk lele-bakar 12000 2\n` +
                    `/keluar gas 25000\n` +
                    `/belanja bumbu 50000\n` +
                    `/laporan mingguan\n\n` +
                    `💡 Tips: Gunakan tanda (-) untuk spasi pada nama item`;
    
    await sock.sendMessage(from, { text: helpText });
}

// Jalankan bot
console.log('🚀 Memulai Bot WhatsApp Warung Pecel Lele...');
connectToWhatsApp().catch(err => {
    console.error('❌ Error starting bot:', err);
    process.exit(1);
});

// Handle process termination
process.on('SIGINT', () => {
    console.log('👋 Bot dihentikan');
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
