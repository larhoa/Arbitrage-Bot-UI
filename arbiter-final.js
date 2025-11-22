// ... (بخش‌های قبلی کد، مطمئن شوید که آدرس‌های ثابت در بالا تماماً کوچک هستند)

// =======================================================================
// === تابع اصلی اجرای آربیتراژ - با ABI استاندارد address[] ===
document.getElementById('runArbitrage').onclick = async () => {
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

        const amountWETH = ethers.utils.parseUnits(amountDecimal, 18);
        
        updateStatus("در حال استعلام قیمت لحظه‌ای WETH -> WBTC...");

        // ۱. آماده‌سازی برای فراخوانی eth_call (استعلام قیمت)
        const routerAbi = ["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"];
        const routerInterface = new ethers.utils.Interface(routerAbi);
        const methodSignature = routerInterface.getSighash("getAmountsOut");
        
        const coder = new ethers.utils.AbiCoder();
        
        // 🔑 اصلاح نهایی: استفاده مجدد از address[] و آدرس‌های تماماً کوچک (WETH_ADDRESS, WBTC_ADDRESS)
        const path = [WETH_ADDRESS, WBTC_ADDRESS]; // آدرس‌های ثابت تماماً کوچک استفاده می‌شوند
        
        const encodedArgs = coder.encode(
            ["uint", "address[]"], // بازگشت به نوع address[] (تایپ صحیح ABI)
            [amountWETH, path]
        );
        
        const callData = methodSignature + encodedArgs.substring(2);

        // ۲. فراخوانی مستقیم eth_call
        const encodedResult = await signer.call({
            to: ROUTER_SWAP_X, 
            data: callData
        });

        // ... (بقیه منطق دیکدینگ، محاسبه slippage و فراخوانی startArbitrage بدون تغییر است)
        const decodedResult = routerInterface.decodeFunctionResult("getAmountsOut", encodedResult);
        let estimatedWBTCReceived = decodedResult[0][1];
        
        const BIGNUMBER_10000 = ethers.BigNumber.from(10000);
        const safetyMarginBPS = ethers.BigNumber.from(10); // 0.1%
        
        const amountOutMinWBTC = estimatedWBTCReceived
            .mul(BIGNUMBER_10000.sub(safetyMarginBPS)) 
            .div(BIGNUMBER_10000); 

        const deadline = Math.floor(Date.now() / 1000) + 60;

        updateStatus(`✅ قیمت استعلام شد. مقدار تخمینی WBTC: ${ethers.utils.formatUnits(estimatedWBTCReceived, 8)}\nمقدار امن برای چک لغزش: ${ethers.utils.formatUnits(amountOutMinWBTC, 8)} WBTC\n\nلطفاً تراکنش را در ولت خود تأیید کنید...`);

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
             errorMessage = "تراکنش با شکست مواجه خواهد شد. (احتمالاً به دلیل لغزش بالا یا خطا در قرارداد)";
        }
        updateStatus(`❌ خطا در اجرای آربیتراژ:\n${errorMessage}\n\n**لطفاً مطمئن شوید که ولت شما به شبکه سونیک متصل است.**`);
    }
};