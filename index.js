
import { config } from 'dotenv';
// Use the URL constructor with import.meta.url for an absolute path to your .env file.
config({ path: new URL('./.env', import.meta.url).pathname });
console.log("Working directory:", process.cwd());

import { ethers, formatEther, parseEther, JsonRpcProvider } from "ethers";
import { formatUnits } from 'ethers';

import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'fs';

import bunnyAbi from './artifacts/bunnyAbi.json' assert { type: 'json' };
import pairAbi from './artifacts/pairAbi.json' assert { type: 'json' };
 
const PANCAKE_SWAP_PAIR = "0xa60874e8557902Ef3039C1b623b55E6E210110dd"; // Dirección del par de liquidez en PancakeSwap
const CASHBUNNY_ADDRESS = "0x2F7c6FCE82a4845726C3744df21Dc87788112B66"; // Dirección del token CashBunny
const TARGET_CONTRACT = "0xa1fce638e9a01d99fb6e910ac0cfa428febe7525"; // Dirección del contrato donde se enviará el 20%

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

console.log(`RPC URL IS ${RPC_URL}`);

// Configuración del bot de Telegram
const bot = new TelegramBot(process.env.TG_TOKEN, { polling: true });
const chatId = process.env.TG_CHAT_ID; 

function sendLog(message) {
  const formattedMessage = `🤖 Bot de Liquidez dice:\n\n${message}`;
  console.log(message); // Conserva el log limpio en consola
  bot.sendMessage(chatId, formattedMessage).catch(err => console.error("Error enviando mensaje a Telegram:", err));
}

async function main() {
    const provider = new JsonRpcProvider(RPC_URL);

    const signer = new ethers.Wallet(PRIVATE_KEY, provider); // Clave privada del remitente
    const contract = new ethers.Contract(PANCAKE_SWAP_PAIR, pairAbi, provider);
    const contractBunny = new ethers.Contract(CASHBUNNY_ADDRESS, bunnyAbi, provider);

    const targetContract = new ethers.Contract(TARGET_CONTRACT, [
      "function handleSellAmount(uint256 _amount) external",
      "function addLiquidity() external"
    ], signer);

    const handleSwap = async (sender, amount0In, amount1In, amount0Out, amount1Out, to) => {
        // Convertir valores a BigNumber
        console.log(`Amount0Out: ${amount0Out} CashBunny recibidos.`);
        console.log(`Amount1Out: ${amount1Out} CashBunny recibidos.`);
        
        const balance = await contractBunny.balanceOf(targetContract);
        const formattedBalance = formatUnits(balance, 18); // 18 decimales estándar

        sendLog(`Balance Disponible para Venta y Liquidez: ${formattedBalance} CashBunny.`);

         // 🛑 Ignorar eventos de venta (cuando amount1Out > 0 significa que fue venta)
        if (amount1Out > 0) {
          sendLog("Venta detectada. Ignorar!");
          return; // Sale de la función sin hacer nada
        
        } 

        if (balance < 1000000n) {  
          sendLog("⚠️Balance de Bunny bajo, agregar más lo antes posible.");
        }

        if (amount0Out >= 100000n) {
          const tokensReceived = amount0Out; // CashBunny recibido
          const formattedTokenReceived = formatUnits(tokensReceived, 18); // 18 decimales estándar

          sendLog(`✅ Compra detectada: ${formattedTokenReceived} CashBunny recibidos.`);
          
          const tax = parseEther(`${Number(formattedTokenReceived) * 0.2}`);
          
          try {

            //estimate gas
            let gas = await targetContract.handleSellAmount.estimateGas(tax);

            if (gas > 0) {

              const txSell = await targetContract.handleSellAmount(tax, {
                gasLimit: `1000000`,
              });

              await txSell.wait();

            } else {
              sendLog("❌ (handleSellAmount) Error: Gas estimado es 0.");
            }

            const formattedTax = formatEther(`${tax}`); 
            sendLog(`🟢 Venta de ${formattedTax} tokens ejecutada.`);
            
            gas = await targetContract.addLiquidity.estimateGas();
            
            if (gas > 0) {
              // Luego de la venta, agregar liquidez
              const txLiquidity = await targetContract.addLiquidity({
                gasLimit: `1000000`,
              });

              await txLiquidity.wait();
              sendLog("💧 Liquidez agregada correctamente.");
            } else {
              sendLog("❌ (addLiquidity) Error: Gas estimado es 0.");
            }

            sendLog("🤖 Bunny_bot Activo de nuevo...");

          } catch (error) {
            sendLog(`❌ Error en la operación: ${error.message}`);
          }
      };
    }
    
    contract.on("Swap",  handleSwap);
    
    sendLog("🤖 Bunny_bot escuchando eventos de compra en PancakeSwap...");
}
    
main().catch(console.error);
    