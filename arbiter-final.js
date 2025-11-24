// =======================================================================
// === تعریف ثابت‌ها (Constants) - آدرس‌های شبکه Sonic ===
// **حتماً این آدرس را با آدرس قرارداد دیپلوی شده خود جایگزین کنید**
const CONTRACT_ADDRESS = "0xab5a031ca0491fce7df348f9a4dfed0410a7a7b5"; 

const WETH_ADDRESS = "0x50c42dEAcD8Fc9773493ED674b675bE577f2634b"; // WETH
const USDC_ADDRESS = "0x29219dd400f2Bf60E5a23d13Be72B486D4038894"; // USDC
const ROUTER_SWAP_X = "0xa047e2abf8263fca7c368f43e2f960a06fd9949f"; // روتر SwapX
const USDC_DECIMALS = 6; // دکیمال استاندارد USDC (اگر در شبکه Sonic ۱۸ است، آن را تغییر دهید)

// ABI اصلاح شده برای مطابقت با پارامترهای جدید: amountWETH, estimatedUSDCReceived, deadline
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
// === تابع اصلی اجرای آربیتراژ (اصلاح شده برای USDC) ===
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

        const amountWETH = window.ethers.utils.parseUnits(amountDecimal, 18); // WETH همیشه 18 دکیمال دارد
        
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> USDC در SwapX...");

        // ۱. آماده‌سازی برای فراخوانی eth_call
        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new window.ethers.utils.Interface(routerAbi);
        const methodSignature = routerInterface.getSighash("getAmountsOut");
        
        const coder = new window.ethers.utils.AbiCoder();
        
        // مسیر سواپ WETH -> USDC
        const path = [WETH_ADDRESS.toLowerCase(), USDC_ADDRESS.toLowerCase()]; 
        
        const encodedArgs = coder.encode(
            ["uint", "address[]"], 
            [amountWETH, path]
        );
        
        const callData = methodSignature + encodedArgs.substring(2);

        // ۲. فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ROUTER_SWAP_X, 
            data: callData
        });

        // ۳. دیکد کردن نتیجه و محاسبه Slippage
        const decodedResult = routerInterface.decodeFunctionResult("getAmountsOut", encodedResult);
        let estimatedUSDCReceived = decodedResult[0][1];
        
        const BIGNUMBER_10000 = window.ethers.BigNumber.from(10000);
        const safetyMarginBPS = window.ethers.BigNumber.from(10); // 0.1%
        
        const amountOutMinUSDC = estimatedUSDCReceived
            .mul(BIGNUMBER_10000.sub(safetyMarginBPS)) 
            .div(BIGNUMBER_10000); 

        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی USDC: ${window.ethers.utils.formatUnits(estimatedUSDCReceived, USDC_DECIMALS)}\nمقدار امن برای چک لغزش: ${window.ethers.utils.formatUnits(amountOutMinUSDC, USDC_DECIMALS)} USDC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // ۴. فراخوانی تابع startArbitrage (پارامتر دوم اکنون estimatedUSDCReceived است)
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
        if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
             errorMessage = "تراکنش با شکست مواجه خواهد شد. (بررسی کنید که آیا قرارداد دارای موجودی WETH است؟)";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};