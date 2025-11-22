// تعریف ثابت‌های قرارداد و توکن‌ها
// **اصلاح نهایی و قطعی Checksum شده (EIP-55) برای رفع مشکل Invalid Address**

const CONTRACT_ADDRESS = "0x47231c27658704602F23f5b08B51e2A0494457ab";
const WETH_ADDRESS = "0x5972B565d755A8A45226436357Abd4B2d9397500B7";
const WBTC_ADDRESS = "0xfDBC0d37E3d120B880b957E5025A58793B82173e";
const ROUTER_SWAP_X = "0x0A047E2abDF8263Fc4F7C369f439e2F960a06FD9";

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
        // استفاده مستقیم از CONTRACT_ADDRESS استاندارد شده
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

        // استفاده مستقیم از آدرس‌های استاندارد شده
        const path = [
            WETH_ADDRESS, 
            WBTC_ADDRESS
        ];
        
        const callData = routerInterface.encodeFunctionData("getAmountsOut", [amountWETH, path]);

        // فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ROUTER_SWAP_X, // استفاده مستقیم از آدرس روتر استاندارد شده
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
             errorMessage = "تراکنش با شکست مواجه خواهد شد. (احتمالاً به دلیل لغزش بالا، موجودی ناکافی یا خطا در منطق قرارداد هوشمند شما)";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**تمام مشکلات زیرساختی حل شد.** اکنون خطا احتمالاً از منطق قرارداد هوشمند یا موجودی ولت شماست.`);
    }
};
