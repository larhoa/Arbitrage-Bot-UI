// =======================================================================
// === تعریف ثابت‌ها (Constants) - آدرس‌های اصلی تماماً کوچک ===
// 🔑 آدرس‌ها تماماً کوچک تعریف می‌شوند تا Ethers v5 آن‌ها را بپذیرد.
const CONTRACT_ADDRESS = "0x47231c27658704602f23f5b08b51e2a0494457ab"; 
const WETH_ADDRESS = "0x5972b565d755a8a45226436357abd4b2d9397500b7"; 
const WBTC_ADDRESS = "0xfdbc0d37e3d120b880b957e5025a58793b82173e"; 
const ROUTER_SWAP_X = "0x0a047e2abdf8263fc4f7c369f439e2f960a06fd9"; 

// ABI فقط برای توابع مورد نیاز
const ARBITRAGE_ABI = [
    "function startArbitrage(uint128 amountWETH, uint256 estimatedWBTCReceived, uint256 deadline)"
];

// متغیرهای Ethers (تعریف سراسری)
let signer;
let arbitrageContract;

// =======================================================================
// === توابع کمکی DOM ===
function updateStatus(message) {
    document.getElementById('status').textContent = message;
}

// =======================================================================
// === تابع اصلی اتصال به ولت ===
document.getElementById('connectWallet').onclick = async () => {
    const ethers = window.ethers;
    
    // 🛑 دور زدن نهایی: آدرس‌ها را به طور موقت در یک شیء کوچک می‌کنیم
    const Addresses = {
        WETH: WETH_ADDRESS.toLowerCase(), // تضمین کوچک بودن
        WBTC: WBTC_ADDRESS.toLowerCase(),
        ROUTER: ROUTER_SWAP_X.toLowerCase()
    };
    
    // (بقیه چک‌های اتصال)
    if (typeof window.ethereum === 'undefined' || typeof ethers === 'undefined') {
        updateStatus("❌ ولت یا کتابخانه Ethers پیدا نشد.");
        return;
    }

    try {
        const provider = new ethers.providers.Web3Provider(window.ethereum, 146);
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []); 
        signer = provider.getSigner();
        
        // ⚠️ مهم: استفاده از WETH_ADDRESS اصلی در اینجا مشکلی ندارد، اما در ادامه از Addresses استفاده می‌کنیم.
        arbitrageContract = new ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer); 
        
        const signerAddress = await signer.getAddress();
        
        updateStatus(`✅ اتصال موفق. آدرس شما: ${signerAddress}`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
        // اگر خطا به دلیل Checksum بود، آدرس را نمایش نده
        let errorMessage = error.message.includes('Invalid address') ? "خطای اعتبارسنجی آدرس (Checksum) همچنان فعال است. کش را پاک کنید." : error.message;
        updateStatus(`❌ خطای اتصال به ولت: ${errorMessage}`);
    }
};

// =======================================================================
// === تابع اصلی اجرای آربیتراژ ===
document.getElementById('runArbitrage').onclick = async () => {
    const ethers = window.ethers;
    
    // 🛑 بازسازی آدرس‌ها از روی ثابت‌ها با toLowerCase() در هر بار اجرا
    const WETH_LOWER = WETH_ADDRESS.toLowerCase();
    const WBTC_LOWER = WBTC_ADDRESS.toLowerCase();
    const ROUTER_LOWER = ROUTER_SWAP_X.toLowerCase();

    if (!signer) {
        updateStatus("لطفاً ابتدا به ولت متصل شوید.");
        return;
    }

    try {
        // ... (چک مقدار و parseUnits)
        const amountDecimal = document.getElementById('amount').value;
        if (!amountDecimal || isNaN(amountDecimal) || Number(amountDecimal) <= 0) {
            updateStatus("❌ لطفاً یک مقدار معتبر برای وام وارد کنید.");
            return;
        }
        const amountWETH = ethers.utils.parseUnits(amountDecimal, 18);
        
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC...");

        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new ethers.utils.Interface(routerAbi);
        const methodSignature = routerInterface.getSighash("getAmountsOut");
        
        // ⚠️ مهم: در اینجا از آدرس‌های کوچک شده (LOWER) استفاده می‌کنیم
        const path = [WETH_LOWER, WBTC_LOWER];
        
        const coder = new ethers.utils.AbiCoder();
        const encodedArgs = coder.encode(
            ["uint", "address[]"], 
            [amountWETH, path]
        );
        const callData = methodSignature + encodedArgs.substring(2);

        // فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ROUTER_LOWER, // ⚠️ استفاده از آدرس کوچک شده برای روتر
            data: callData
        });

        // ... (بقیه منطق دیکدینگ، محاسبه اسلیپیج و فراخوانی قرارداد)
        // دیکد کردن نتیجه
        const decodedResult = routerInterface.decodeFunctionResult("getAmountsOut", encodedResult);
        
        let estimatedWBTCReceived = decodedResult[0][1];
        
        const BIGNUMBER_10000 = ethers.BigNumber.from(10000);
        const safetyMarginBPS = ethers.BigNumber.from(10); 
        
        const amountOutMinWBTC = estimatedWBTCReceived
            .mul(BIGNUMBER_10000.sub(safetyMarginBPS)) 
            .div(BIGNUMBER_10000); 

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
        
        await tx.wait();
        
        updateStatus(`🚀 عملیات آربیتراژ با موفقیت انجام شد!\nهش تراکنش: ${tx.hash}`);

    } catch (error) {
        console.error("Arbitrage execution failed:", error);
        
        let errorMessage = error.message || "خطای ناشناخته.";
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
             errorMessage = "تراکنش با شکست مواجه خواهد شد.";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};
