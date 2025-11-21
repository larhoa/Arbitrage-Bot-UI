// تعریف ثابت‌های قرارداد و توکن‌ها (از Deploy Remix)
const CONTRACT_ADDRESS = "0x47231c27658704602f23f5b08b51e2a0494457ab"; 
const WETH_ADDRESS = "0x5972B565d755A8A4526543b57A94D480397500B7"; 
const WBTC_ADDRESS = "0xfdbc0d37e3d120B880b957e5025a58793b82173E"; 
const ROUTER_SWAP_X = "0x0A047e2aBdf8263FC4F7C369F439E2F960A06FD9"; 

// ABI فقط برای توابع مورد نیاز (حجم فایل را کم می‌کند)
const ARBITRAGE_ABI = [
    "function startArbitrage(uint128 amountWETH, uint256 estimatedWBTCReceived, uint256 deadline)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

// متغیرهای Ethers
let provider;
let signer;
let arbitrageContract;
let routerSwapX;

// --- توابع کمکی DOM ---
function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// --- تابع اصلی اتصال به ولت ---
document.getElementById('connectWallet').onclick = async () => {
    if (typeof window.ethereum === 'undefined') {
        updateStatus("❌ ولت (MetaMask یا Rabby) در مرورگر پیدا نشد. لطفاً نصب کنید.");
        return;
    }

    try {
        // ۱. اتصال به Provider تزریق شده (کیف پول)
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // ۲. درخواست اتصال حساب‌ها
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []); 
        
        // ۳. دریافت امضاکننده (Signer)
        signer = await provider.getSigner();
        
        // ۴. ساختن اینترفیس‌های قرارداد
        arbitrageContract = new ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer);
        // روتر را فقط برای استعلام قیمت (بدون نیاز به امضا) با provider می‌سازیم
        routerSwapX = new ethers.Contract(ROUTER_SWAP_X, ARBITRAGE_ABI, provider); 

        updateStatus(`✅ اتصال موفق. آدرس شما: ${signer.address}\nشما در حال استفاده از شبکه Arbitrum One هستید.`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        updateStatus(`❌ خطای اتصال به ولت: ${error.message}`);
    }
};

// --- تابع اصلی اجرای آربیتراژ ---
document.getElementById('runArbitrage').onclick = async () => {
    if (!signer) {
        updateStatus("لطفاً ابتدا به ولت متصل شوید.");
        return;
    }

    try {
        const amountDecimal = document.getElementById('amount').value;
        // تبدیل مقدار اعشاری WETH به واحد Wei (18 رقم اعشار)
        const amountWETH = ethers.parseUnits(amountDecimal, 18); 
        
        // --- ۱. استعلام قیمت لحظه‌ای (برای محاسبه estimatedWBTCReceived) ---
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC...");

        const path = [WETH_ADDRESS, WBTC_ADDRESS];
        // فراخوانی getAmountsOut از روتر (توجه: WBTC 8 رقم اعشار دارد)
        let amountsOut = await routerSwapX.getAmountsOut(amountWETH, path);
        
        // amountsOut[1] مقدار WBTC دریافتی است
        let estimatedWBTCReceived = amountsOut[1];
        
        // برای امنیت بیشتر، یک مارجین کوچک (مثلاً 0.1%) کم می‌کنیم تا لغزش کوچک باعث شکست نشود
        // 10000 = 100%، پس 9999/10000 یعنی 0.01% لغزش مجاز
        const safetyMarginBPS = 10; // 0.1% = 10 basis points
        const amountOutMinWBTC = (estimatedWBTCReceived * BigInt(10000 - safetyMarginBPS)) / BigInt(10000);

        // --- ۲. تنظیم ددلاین ---
        // ددلاین را 60 ثانیه در آینده قرار می‌دهیم
        const deadline = Math.floor(Date.now() / 1000) + 60; 

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی WBTC: ${ethers.formatUnits(estimatedWBTCReceived, 8)}\nمقدار امن برای چک لغزش: ${ethers.formatUnits(amountOutMinWBTC, 8)} WBTC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // --- ۳. فراخوانی تابع startArbitrage (نیاز به امضا) ---
        const tx = await arbitrageContract.startArbitrage(
            amountWETH,
            amountOutMinWBTC, // از مقدار امن برای estimatedWBTCReceived استفاده می‌کنیم
            deadline,
            { 
                gasLimit: 3000000, 
            }
        );

        updateStatus(`🔔 تراکنش ارسال شد: ${tx.hash}\nدر انتظار تأیید شدن بلاک...`);
        
        // صبر کردن برای تأیید تراکنش
        await tx.wait(); 
        
        updateStatus(`🚀 عملیات آربیتراژ با موفقیت انجام شد!\nهش تراکنش: ${tx.hash}`);

    } catch (error) {
        console.error(error);
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${error.message || "خطای ناشناخته. مطمئن شوید که آدرس‌ها و موجودی گس ولت صحیح است."}`);
    }
};