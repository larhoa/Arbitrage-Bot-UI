// =======================================================================
// === تعریف ثابت‌ها (Constants) - شبکه Sonic ===
// **توجه:** آدرس‌ها بر اساس آخرین تأیید شما به‌روزرسانی شده‌اند.
const CONTRACT_ADDRESS = "0xab5a031ca0491fce7df348f9a4dfed0410a7a7b5"; // آدرس قرارداد دیپلوی شده شما
const WETH_ADDRESS = "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b"; // WETH
const USDC_ADDRESS = "0x29219dd400f2Bf60E5a23d13Be72B486D4038894"; // USDC
const ROUTER_SWAP_X = "0xa047e2abf8263fca7c368f43e2f960a06fd9949f"; // روتر SwapX (تماماً کوچک برای جلوگیری از خطای Checksum)
const USDC_DECIMALS = 6; // دکیمال USDC در شبکه Sonic

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
// === تابع اصلی اتصال به ولت ===
document.getElementById('connectWallet').onclick = async () => {
    
    if (typeof window.ethereum === 'undefined') {
        updateStatus("❌ ولت (MetaMask یا Rabby) در مرورگر پیدا نشد. لطفاً نصب کنید.");
        return;
    }
    if (typeof window.ethers === 'undefined') {
        updateStatus("❌ خطای اتصال به ethers: کتابخانه Ethers.js در مرورگر بارگذاری نشد.");
        return;
    }

    try {
        // ساخت Provider (باید به شبکه Sonic متصل باشد)
        const provider = new window.ethers.providers.Web3Provider(window.ethereum);
        
        updateStatus("در حال درخواست اتصال به کیف پول...");
        await provider.send("eth_requestAccounts", []); 
        signer = provider.getSigner();
        
        // ساختن اینترفیس قرارداد اصلی
        arbitrageContract = new window.ethers.Contract(CONTRACT_ADDRESS, ARBITRAGE_ABI, signer); 
        
        const signerAddress = await signer.getAddress();
        
        updateStatus(`✅ اتصال موفق. آدرس شما: ${signerAddress}`);
        document.getElementById('runArbitrage').disabled = false;
        document.getElementById('connectWallet').disabled = true;

    } catch (error) {
        console.error("Wallet connection failed:", error);
        updateStatus(`❌ خطای اتصال به ولت: ${error.message}\nلطفاً مطمئن شوید ولت شما به شبکه سونیک متصل است.`);
    }
};

// =======================================================================
// === تابع اصلی اجرای آربیتراژ (بایپس شده) ===
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

        const amountWETH = window.ethers.utils.parseUnits(amountDecimal, 18);
        
        // ***************************************************************
        // *** بایپس مرحله استعلام قیمت (signer.call) به دلیل خطای روتر ***
        // ***************************************************************
        
        // ⚠️ برای تست جریان اجرای قرارداد، مقدار حداقل را روی صفر تنظیم می‌کنیم.
        // این یعنی حفاظت در برابر لغزش در سطح فرانت‌اند غیرفعال است.
        const amountOutMinUSDC = window.ethers.BigNumber.from(0); 
        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`⚠️ استعلام قیمت به دلیل خطای روتر بایپس شد. مقدار حداقل USDC: صفر. \n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // ۴. فراخوانی تابع startArbitrage (نیاز به امضا)
        const tx = await arbitrageContract.startArbitrage(
            amountWETH,
            amountOutMinUSDC, // مقدار صفر برای تست
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
             errorMessage = "**❌ خطای تراکنش: احتمالاً فرصت آربیتراژ وجود ندارد یا سود آنقدر کم است که هزینه گس را پوشش نمی‌دهد.**";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};