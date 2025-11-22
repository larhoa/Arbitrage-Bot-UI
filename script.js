// تعریف ثابت‌های قرارداد و توکن‌ها
// **وضعیت:** آدرس‌ها به حروف کوچک تبدیل شدند تا مشکل Checksum حل شود.

const CONTRACT_ADDRESS = "0x47231c27658704602f23f5b08b51e2a0494457ab".toLowerCase();
const WETH_ADDRESS = "0x5972b565d755a8a45226436357abd4b2d9397500b7".toLowerCase();
const WBTC_ADDRESS = "0xfdbc0d37e3d120b880b957e5025a58793b82173e".toLowerCase();
const ROUTER_SWAP_X = "0x0a047e2abdf8263fc4f7c369f439e2f960a06fd9".toLowerCase();

// ABI فقط برای توابع مورد نیاز
const ARBITRAGE_ABI = [
    "function startArbitrage(uint128 amountWETH, uint256 estimatedWBTCReceived, uint256 deadline)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

// متغیرهای Ethers
let provider; // Provider تزریق شده توسط ولت (برای امضا)
let routerProvider; // **جدید:** Provider اختصاصی RPC سونیک (برای استعلام قیمت)
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

    // ... (داخل document.getElementById('connectWallet').onclick)

    try {
        // ۱. اتصال به Provider تزریق شده (کیف پول)
        provider = new ethers.BrowserProvider(window.ethereum);
        
        // **اصلاح نهایی و دقیق برای شبکه سونیک:** استفاده از PublicNode مخصوص سونیک
        const SONIC_RPC_URL = "https://sonic.publicnode.com"; // RPC عمومی و پایدار سونیک
        routerProvider = new ethers.JsonRpcProvider(SONIC_RPC_URL);

// ... (بقیه کد)

        // ۲. درخواست اتصال حساب‌ها
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []);
        
        // ۳. دریافت امضاکننده (Signer)
        signer = await provider.getSigner();
        
        // تنظیمات قرارداد: غیرفعال کردن چک ENS برای جلوگیری از خطای UNSUPPORTED_OPERATION
        const contractOptions = {
            ens: null
        };

        // ۴. ساختن اینترفیس‌های قرارداد
        // قرارداد اصلی آربیتراژ (نیاز به امضا) از signer ولت استفاده می‌کند.
        arbitrageContract = new ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer, contractOptions);
        
        // روتر (استعلام قیمت) از routerProvider اختصاصی و RPC مستقیم سونیک استفاده می‌کند.
        routerSwapX = new ethers.Contract(ROUTER_SWAP_X, ARBITRAGE_ABI, routerProvider, contractOptions); 

        updateStatus(`✅ اتصال موفق. آدرس شما: ${signer.address}\nشما در حال استفاده از شبکه سونیک هستید.`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
        // پیام وضعیت را به "سونیک" تغییر دادیم تا با شبکه هدف همخوانی داشته باشد
        updateStatus(`❌ خطای اتصال به ولت: ${error.message}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
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
        if (!amountDecimal || isNaN(amountDecimal) || Number(amountDecimal) <= 0) {
            updateStatus("❌ لطفاً یک مقدار معتبر برای وام وارد کنید.");
            return;
        }

        // تبدیل مقدار اعشاری WETH به واحد Wei (18 رقم اعشار)
        const amountWETH = ethers.parseUnits(amountDecimal, 18);
        
        // --- ۱. استعلام قیمت لحظه‌ای (برای محاسبه estimatedWBTCReceived) ---
        // این فراخوانی از routerProvider اختصاصی استفاده می‌کند.
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC...");

        const path = [WETH_ADDRESS, WBTC_ADDRESS];
        // فراخوانی getAmountsOut از روتر (توجه: WBTC 8 رقم اعشار دارد)
        let amountsOut = await routerSwapX.getAmountsOut(amountWETH, path);
        
        // amountsOut[1] مقدار WBTC دریافتی است
        let estimatedWBTCReceived = amountsOut[1];
        
        // محاسبه slippage (لغزش) با BigInt برای دقت بالا
        const safetyMarginBPS = 10n; // 0.1% = 10 basis points
        const amountOutMinWBTC = (estimatedWBTCReceived * (10000n - safetyMarginBPS)) / 10000n;

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
        console.error("Arbitrage execution failed:", error);
        
        let errorMessage = error.message || "خطای ناشناخته.";
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
             errorMessage = "تراکنش با شکست مواجه خواهد شد. (ممکن است به دلیل لغزش بالا، موجودی ناکافی یا خطا در منطق قرارداد باشد)";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\nمطمئن شوید که آدرس‌ها و موجودی گس ولت صحیح است.`);
    }
};


