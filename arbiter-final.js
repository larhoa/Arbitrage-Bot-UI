// =======================================================================
// === تعریف ثابت‌ها (Constants) - شبکه Sonic ===
const CONTRACT_ADDRESS = "0xab5a031ca0491fce7df348f9a4dfed0410a7a7b5"; // آدرس قرارداد دیپلوی شده شما
const WETH_ADDRESS = "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b"; // WETH (18 decimals)
const USDC_ADDRESS = "0x29219dd400f2Bf60E5a23d13Be72B486D4038894"; // USDC
const ROUTER_SWAP_X = "0xa047e2abf8263fca7c368f43e2f960a06fd9949f"; // روتر SwapX (تماماً کوچک)
const USDC_DECIMALS = 6; // دکیمال USDC در شبکه Sonic

// === ثابت جدید: آدرس استخر مرجع قیمت (Pool Reserves) ===
const REFERENCE_POOL_ADDRESS = "0x7E50357098dA4d25735127128B2ffce21A269913"; 
const POOL_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

// متغیرهای نرخ
let CURRENT_WETH_TO_USDC_RATE = 2835; // مقدار پیش‌فرض (Fall-back)
const SLIPPAGE_TOLERANCE_PERCENT = 0.5; // 0.5% لغزش قابل قبول

// ABI اصلاح شده
const ARBITRAGE_ABI = [
    "function startArbitrage(uint128 amountWETH, uint256 estimatedUSDCReceived, uint256 deadline)"
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
// === تابع جدید: دریافت نرخ لحظه‌ای از Reserves استخر ===
async function fetchCurrentRate() {
    updateStatus("⏳ در حال دریافت نرخ لحظه‌ای از Pool Reserves...");
    try {
        // برای فراخوانی Pool Reserves از یک Provider عمومی استفاده می‌کنیم (نیازی به امضای ولت نیست)
        const provider = new window.ethers.providers.Web3Provider(window.ethereum);
        const poolContract = new window.ethers.Contract(REFERENCE_POOL_ADDRESS, POOL_ABI, provider);
        
        const token0Address = await poolContract.token0();
        const reserves = await poolContract.getReserves();
        
        let reserveWETH, reserveUSDC;
        
        // تشخیص اینکه کدام توکن (WETH یا USDC) در reserve0 یا reserve1 قرار دارد
        if (token0Address.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
            reserveWETH = reserves.reserve0;
            reserveUSDC = reserves.reserve1;
        } else {
            reserveWETH = reserves.reserve1;
            reserveUSDC = reserves.reserve0;
        }

        // تبدیل reserves به واحدهای قابل خواندن (18 دکیمال برای WETH و 6 دکیمال برای USDC)
        const amountWETH = window.ethers.utils.formatUnits(reserveWETH, 18);
        const amountUSDC = window.ethers.utils.formatUnits(reserveUSDC, USDC_DECIMALS); 

        // محاسبه نرخ: Rate = USDC / WETH
        const newRate = parseFloat(amountUSDC) / parseFloat(amountWETH);
        
        if (!isNaN(newRate) && newRate > 0) {
            CURRENT_WETH_TO_USDC_RATE = newRate;
            updateStatus(`✅ نرخ لحظه‌ای به‌روزرسانی شد. 1 WETH ≈ ${newRate.toFixed(4)} USDC (از Pool Reserves).`);
        } else {
            updateStatus(`⚠️ خطای محاسبه نرخ Pool. از نرخ پیش‌فرض ${CURRENT_WETH_TO_USDC_RATE} استفاده می‌شود.`);
        }
    } catch (error) {
        console.error("Could not fetch live rate from Pool:", error);
        updateStatus(`❌ خطای اتصال به Pool. از نرخ پیش‌فرض ${CURRENT_WETH_TO_USDC_RATE} استفاده می‌شود.`);
    }
}


// =======================================================================
// === تابع اصلی اتصال به ولت (با فراخوانی نرخ) ===
document.getElementById('connectWallet').onclick = async () => {
    
    // ۱. دریافت نرخ لحظه‌ای قبل از اتصال کامل (دقیق‌ترین اوراکل)
    await fetchCurrentRate();

    if (typeof window.ethereum === 'undefined') {
        updateStatus("❌ ولت (MetaMask یا Rabby) در مرورگر پیدا نشد. لطفاً نصب کنید.");
        return;
    }
    if (typeof window.ethers === 'undefined') {
        updateStatus("❌ خطای اتصال به ethers: کتابخانه Ethers.js در مرورگر بارگذاری نشد.");
        return;
    }

    try {
        const provider = new window.ethers.providers.Web3Provider(window.ethereum);
        
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []); 
        signer = provider.getSigner();
        
        arbitrageContract = new window.ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer); 
        
        const signerAddress = await signer.getAddress();
        
        updateStatus(`✅ اتصال موفق. آدرس شما: ${signerAddress} | نرخ لحظه‌ای: ${CURRENT_WETH_TO_USDC_RATE} USDC`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
        updateStatus(`❌ خطای اتصال به ولت: ${error.message}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
    }
};

// =======================================================================
// === تابع اصلی اجرای آربیتراژ (با حفاظت از Reserves) ===
document.getElementById('runArbitrage').onclick = async () => {
    
    if (!signer) {
        updateStatus("لطفاً ابتدا به ولت متصل شوید.");
        return;
    }

    try {
        // حتماً نرخ را قبل از اجرا به‌روزرسانی کنید تا دقت بالا رود
        await fetchCurrentRate();
        
        const amountDecimal = document.getElementById('amount').value;
        if (!amountDecimal || isNaN(amountDecimal) || Number(amountDecimal) <= 0) {
            updateStatus("❌ لطفاً یک مقدار معتبر برای وام وارد کنید.");
            return;
        }

        const amountWETH = window.ethers.utils.parseUnits(amountDecimal, 18);
        
        // *******************************************************************
        // *** محاسبه مقدار خروجی حداقل (amountOutMinUSDC) با نرخ Reserves ***
        // *******************************************************************
        
        // ۱. محاسبه مقدار USDC مورد انتظار با نرخ لحظه‌ای (از Pool Reserves)
        const expectedUSDC = amountDecimal * CURRENT_WETH_TO_USDC_RATE;
        
        // ۲. اعمال فاکتور لغزش
        const slippageFactor = 1 - (SLIPPAGE_TOLERANCE_PERCENT / 100); 
        const amountOutMinDecimal = expectedUSDC * slippageFactor;
        
        // ۳. تبدیل به فرمت BigNumber با 6 دکیمال USDC
        const amountOutMinUSDC = window.ethers.utils.parseUnits(
            amountOutMinDecimal.toFixed(USDC_DECIMALS), // اطمینان از 6 رقم اعشار USDC
            USDC_DECIMALS 
        );
        
        const deadline = Math.floor(Date.now() / 1000) + 60; // 60 ثانیه زمان انقضا
        
        updateStatus(`⚠️ استعلام قیمت بایپس شد. حداقل USDC مورد نیاز: ${window.ethers.utils.formatUnits(amountOutMinUSDC, USDC_DECIMALS)} USDC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // ۴. فراخوانی تابع startArbitrage (نیاز به امضا)
        const tx = await arbitrageContract.startArbitrage(
            amountWETH,
            amountOutMinUSDC, 
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
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT' || error.code === 'CALL_EXCEPTION') {
             errorMessage = "**❌ خطای تراکنش: احتمالاً فرصت آربیتراژ وجود ندارد (سود کمتر از گس است).**";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};