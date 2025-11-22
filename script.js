// تعریف ثابت‌های قرارداد و توکن‌ها
// ⚠️ اقدام کلیدی: استفاده از toLowerCase() در زمان تعریف برای جلوگیری از خطای Checksum
const CONTRACT_ADDRESS = "0x47231c27658704602f23f5b08b51e2a0494457ab".toLowerCase();
const WETH_ADDRESS = "0x5972B565d755A8A45226436357aBd4B2D9397500B7".toLowerCase();
const WBTC_ADDRESS = "0xfdbc0d37e3d120b880b957e5025a58793b82173e".toLowerCase();
const ROUTER_SWAP_X = "0x0A047E2ABdF8263FC4f7C369f439e2F960A06fd9".toLowerCase();

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
    // ⚠️ استفاده از window.ethers برای دسترسی به کتابخانه v5
    const ethers = window.ethers; 
    
    if (typeof window.ethereum === 'undefined') {
        updateStatus("❌ ولت (MetaMask یا Rabby) در مرورگر پیدا نشد. لطفاً نصب کنید.");
        return;
    }
    if (typeof ethers === 'undefined') {
        updateStatus("❌ خطای اتصال به ethers: کتابخانه Ethers.js در مرورگر بارگذاری نشد.");
        return;
    }

    try {
        // ۱. ساخت Provider با استفاده از Web3Provider (سازگار با Ethers v5)
        // چین آیدی سونیک: 146
        const provider = new ethers.providers.Web3Provider(window.ethereum, 146);
        
        // ۲. درخواست اتصال حساب‌ها
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []);
        
        // ۳. دریافت امضاکننده (Signer)
        signer = provider.getSigner();
        
        // ۴. ساختن اینترفیس قرارداد اصلی
        arbitrageContract = new ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer);
        
        // دریافت آدرس امضاکننده
        const signerAddress = await signer.getAddress();
        
        updateStatus(`✅ اتصال موفق. آدرس شما: ${signerAddress}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
        updateStatus(`❌ خطای اتصال به ولت: ${error.message}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
    }
};

// --- تابع اصلی اجرای آربیتراژ ---
document.getElementById('runArbitrage').onclick = async () => {
    // ⚠️ استفاده از window.ethers برای دسترسی به کتابخانه v5
    const ethers = window.ethers; 
    
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
        const amountWETH = ethers.utils.parseUnits(amountDecimal, 18);
        
        // --- ۱. استعلام قیمت لحظه‌ای (با فراخوانی خام eth_call) ---
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC از طریق فراخوانی خام ولت...");

        // ساختن داده‌های فراخوانی برای getAmountsOut
        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new ethers.utils.Interface(routerAbi);
        
        // امضای متد (Method Signature) برای getAmountsOut
        const methodSignature = routerInterface.getSighash("getAmountsOut");
        
        // آدرس‌های Path - تماماً کوچک شده در زمان تعریف ثابت‌ها
        const path = [WETH_ADDRESS, WBTC_ADDRESS];
        
        // استفاده از AbiCoder - آدرس‌ها باید اینجا تماماً کوچک باشند.
        const coder = new ethers.utils.AbiCoder();
        const encodedArgs = coder.encode(
            ["uint", "address[]"], 
            [amountWETH, path]
        );
        
        // ترکیب امضا و آرگومان‌های Encoded
        const callData = methodSignature + encodedArgs.substring(2);

        // فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ROUTER_SWAP_X, 
            data: callData
        });

        // دیکد کردن نتیجه
        const decodedResult = routerInterface.decodeFunctionResult("getAmountsOut", encodedResult);
        
        // decodedResult[0] آرایه amounts است. amounts[1] مقدار WBTC دریافتی است.
        let estimatedWBTCReceived = decodedResult[0][1];
        
        // محاسبه slippage (لغزش)
        const BIGNUMBER_10000 = ethers.BigNumber.from(10000);
        const safetyMarginBPS = ethers.BigNumber.from(10); // 0.1% = 10 basis points
        
        const amountOutMinWBTC = estimatedWBTCReceived
            .mul(BIGNUMBER_10000.sub(safetyMarginBPS)) 
            .div(BIGNUMBER_10000); 

        // --- ۲. تنظیم ددلاین ---
        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی WBTC: ${ethers.utils.formatUnits(estimatedWBTCReceived, 8)}\nمقدار امن برای چک لغزش: ${ethers.utils.formatUnits(amountOutMinWBTC, 8)} WBTC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

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
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};
