// تعریف ثابت‌های قرارداد و توکن‌ها
// **وضعیت:** آدرس‌ها به حروف کوچک برگشت داده شدند. اعتبار سنجی EIP-55 با استفاده از ethers.getAddress در زمان اجرا انجام خواهد شد.

const CONTRACT_ADDRESS = "0x47231c27658704602f23f5b08b51e2a0494457ab".toLowerCase();
const WETH_ADDRESS = "0x5972b565d755a8a45226436357abd4b2d9397500b7".toLowerCase();
const WBTC_ADDRESS = "0xfdbc0d37e3d120b880b957e5025a58793b82173e".toLowerCase();
const ROUTER_SWAP_X = "0x0a047e2abdf8263fc4f7c369f439e2f960a06fd9".toLowerCase();

// ABI فقط برای توابع مورد نیاز
const ARBITRAGE_ABI = [
    "function startArbitrage(uint128 amountWETH, uint256 estimatedWBTCReceived, uint256 deadline)"
];

// متغیرهای Ethers
let signer; // امضاکننده
let arbitrageContract; // قرارداد اصلی (نیاز به امضا)

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
        // تعریف دستی شبکه سونیک با ChainID 146 و ENS غیرفعال
        const sonicNetwork = new ethers.Network(
            "Sonic Mainnet",
            146
        );
        sonicNetwork.ensAddress = null; // غیرفعال‌سازی قطعی سرویس ENS

        // ۱. ساخت Provider با استفاده از Network تعریف شده
        const customProvider = new ethers.BrowserProvider(window.ethereum, sonicNetwork);
        
        // ۲. درخواست اتصال حساب‌ها
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await customProvider.send("eth_requestAccounts", []);
        
        // ۳. دریافت امضاکننده (Signer)
        signer = await customProvider.getSigner();
        
        // تنظیمات قرارداد
        const contractOptions = {
            ens: null 
        };

        // ۴. ساختن اینترفیس قرارداد اصلی
        arbitrageContract = new ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer, contractOptions);
        
        updateStatus(`✅ اتصال موفق. آدرس شما: ${signer.address}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
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
        
        // --- ۱. استعلام قیمت لحظه‌ای (با فراخوانی خام eth_call) ---
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC از طریق فراخوانی خام ولت...");

        // ساختن داده‌های فراخوانی برای getAmountsOut
        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new ethers.Interface(routerAbi);

        // **اصلاح نهایی**: اجبار آدرس‌ها به فرمت EIP-55 برای رفع خطای Invalid Address
        const path = [
            ethers.getAddress(WETH_ADDRESS), 
            ethers.getAddress(WBTC_ADDRESS)
        ];
        
        const callData = routerInterface.encodeFunctionData("getAmountsOut", [amountWETH, path]);

        // فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ethers.getAddress(ROUTER_SWAP_X), // آدرس روتر (اعتبارسنجی شده)
            data: callData
        });

        // دیکد کردن نتیجه
        const decodedResult = routerInterface.decodeFunctionResult("getAmountsOut", encodedResult);
        
        // decodedResult[0] آرایه amounts است. amounts[1] مقدار WBTC دریافتی است.
        let estimatedWBTCReceived = decodedResult[0][1];
        
        // محاسبه slippage (لغزش)
        const safetyMarginBPS = 10n; // 0.1% = 10 basis points
        const amountOutMinWBTC = (estimatedWBTCReceived * (10000n - safetyMarginBPS)) / 10000n;

        // --- ۲. تنظیم ددلاین ---
        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی WBTC: ${ethers.formatUnits(estimatedWBTCReceived, 8)}\nمقدار امن برای چک لغزش: ${ethers.formatUnits(amountOutMinWBTC, 8)} WBTC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // --- ۳. فراخوانی تابع startArbitrage (نیاز به امضا) ---
        const tx = await arbitrageContract.startArbitrage(
            amountWETH,
            amountOutMinWBTC,
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
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\nلطفاً برای آخرین بار تست کرده و نتیجه (K41) را ارسال کنید.`);
    }
};
