// =======================================================================
// === تعریف ثابت‌ها (Constants) - آدرس‌های اصلی تماماً کوچک و شامل 0x ===
// این نسخه آدرس‌ها را به صورت استاندارد تعریف می‌کند، اما در زمان استفاده (Encode)، 
// به صورت دفاعی آن‌ها را به حروف کوچک تبدیل می‌کنیم تا خطای Checksum را دور بزنیم.
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
// === تابع اصلی اتصال به ولت - رفع مشکل عدم واکنش دکمه ===
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
        // ساخت Provider با استفاده مستقیم از window.ethers
        const provider = new window.ethers.providers.Web3Provider(window.ethereum, 146);
        
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
// === تابع اصلی اجرای آربیتراژ - رفع خطاهای Checksum و Data Length ===
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
        
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC...");

        // ۱. آماده‌سازی برای فراخوانی eth_call
        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new window.ethers.utils.Interface(routerAbi);
        const methodSignature = routerInterface.getSighash("getAmountsOut");
        
        const coder = new window.ethers.utils.AbiCoder();
        
        // 🔑 ترفند نهایی: استفاده از آدرس‌های ثابت و اعمال اجباری toLowerCase() در زمان encode
        // این کار خطای Checksum Address را که در زمان اجرای آربیتراژ رخ می‌داد، به طور نهایی رفع می‌کند.
        const path = [WETH_ADDRESS.toLowerCase(), WBTC_ADDRESS.toLowerCase()]; 
        
        // استفاده از تایپ صحیح "address[]" (رفع خطای incorrect data length)
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
        let estimatedWBTCReceived = decodedResult[0][1];
        
        const BIGNUMBER_10000 = window.ethers.BigNumber.from(10000);
        const safetyMarginBPS = window.ethers.BigNumber.from(10); // 0.1%
        
        const amountOutMinWBTC = estimatedWBTCReceived
            .mul(BIGNUMBER_10000.sub(safetyMarginBPS)) 
            .div(BIGNUMBER_10000); 

        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی WBTC: ${window.ethers.utils.formatUnits(estimatedWBTCReceived, 8)}\nمقدار امن برای چک لغزش: ${window.ethers.utils.formatUnits(amountOutMinWBTC, 8)} WBTC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

        // ۴. فراخوانی تابع startArbitrage (نیاز به امضا)
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
             errorMessage = "تراکنش با شکست مواجه خواهد شد. (بررسی کنید که آیا قرارداد دارای موجودی WETH است؟)";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً اطمینان حاصل کنید که ولت شما به شبکه سونیک متصل است.**`);
    }
};