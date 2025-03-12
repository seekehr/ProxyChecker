import readline from "readline";
import child from 'child_process';
import executionTime from 'execution-time';
import fs from "fs";
import { promisify } from 'util';
import input from 'readline-sync';
import net from 'net';
import {HttpProxyAgent} from "http-proxy-agent";

const et = executionTime();
const execAsync = promisify(child.exec);
let file;
let type;

console.log("Checking server..");


// TODO: Ping TCP/UDP server through proxy using `net` for (TCP) & `dgram` (for UDP: if socks5)

let target;
const args = process.argv.slice(2);
if (args.length > 0) {
    target = args[0];
    const askFile = () => {
        const fileAns = input.question("Enter the name of your file: ")
        if (!fs.existsSync(fileAns)){
            console.log("Invalid file name");
            askFile();
        } else {
            file = fileAns;
            console.log("Set proxies file to: " + file);
        }
    };
    askFile();

    et.start();

    try {
        const ping = pingTarget(args[0]);
        console.log("Valid server; (" + ping + "ms AVG) " + "(" + et.stop().preciseWords + ")");

        main().then(() => {
            console.log("Main processing complete");
            process.exit(0);
        }).catch(err => {
            console.error("Fatal error in main:", err);
            process.exit(1);
        });
    } catch (e) {
        console.log("Invalid server. Error: " + e.message);
        process.exit(1);
    }
} else if (args.length === 0) {
    console.log("No server specified. Please provide a target server as an argument.");
    process.exit(1);
} else {
    console.log("Invalid arguments. (Too many arguments. Only -u is allowed.)");
    process.exit(1);
}

// Function to ping the target directly
function pingTarget(server) {
    const cmd = child.execSync("ping " + server);
    const avg = cmd.toString().match(/Average\s*=\s*(\d+)/i);
    if (Array.isArray(avg) && avg.length > 0) {
        return avg[1];
    }
    throw new Error("Invalid average ping.");
}

// Function to ping the target through a proxy
async function pingTargetThroughProxy(proxyData) {
    // Extract proxy parts (assuming format like No. 127.0.0.1:8080)
    let [proxyHost, proxyPort] = proxyData.replace(/^\d+\.\s*/, '').split(':');
    console.log(proxyHost)
    proxyPort = parseInt(proxyPort) || 8080;

    // Return a promise that resolves with the ping time or rejects with an error
    return new Promise((resolve, reject) => {
        try {
            const start = Date.now();
            const conn = net.createConnection({
                port: proxyPort,
                host: proxyHost,
                timeout: 5000
            }, () => {
                resolve(Date.now() - start);
                conn.end();
            });

            conn.on('error', (error) => {
               reject(error);
            });
        } catch (e) {
            reject(e);
        }
    });
}

// Main function that calls processProxy and waits for completion
async function main() {
    console.log('Starting proxy processing...');

    try {
        await processProxy();
        console.log('All proxies processed successfully.');
    } catch (error) {
        console.error('Error processing proxies:', error);
        throw error; // Re-throw to be caught by the main catch handler
    }
}

// Process proxies from the file asynchronously
async function processProxy() {
    et.start('proxies');
    try {
        // Verify the file exists before attempting to read
        if (!fs.existsSync(file)) {
            throw new Error(`Proxy file '${file}' not found`);
        }

        const fileStream = fs.createReadStream(file);

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        // Track successful proxies
        const successfulProxies = [];

        // Process lines concurrently with a limit to avoid overwhelming the system
        const MAX_CONCURRENT = 20; // Lower default for proxy connections
        let pendingPromises = [];
        let activePromises = 0;

        let lineCount = 0;
        let processedCount = 0;

        for await (const line of rl) {
            const proxy = line.trim();
            if (proxy) {// Skip empty lines and comments
                // Wait if we've reached the concurrency limit
                while (activePromises >= MAX_CONCURRENT) {
                    // Wait for any promise to complete
                    await Promise.race(pendingPromises);

                    // Update pending promises
                    pendingPromises = pendingPromises.filter(p => p.isCompleted !== true);
                    activePromises = pendingPromises.length;
                }

                // Process this proxy
                const proxyPromise = (async () => {
                    try {
                        console.log(`Testing proxy: ${lineCount} to target ${target}`);
                        const pingTime = await pingTargetThroughProxy(proxy);
                        console.log(`✓ Proxy ${lineCount} successfully reached target: ${pingTime}ms`);
                        successfulProxies.push({ proxy, pingTime });

                        return { success: true, proxy, pingTime };
                    } catch (error) {
                        console.log(`❌ Proxy #${lineCount} failed: ` + error.message);

                        return { success: false, proxy, error: error.message };
                    } finally {
                        processedCount++;
                        proxyPromise.isCompleted = true;

                        // Log progress periodically
                        if (processedCount % 10 === 0 || processedCount === lineCount) {
                            console.log(`Progress: ${processedCount}/${lineCount} proxies processed`);
                        }
                    }
                })();

                pendingPromises.push(proxyPromise);
                activePromises++;
                lineCount++;
            }
        }

        // Wait for all remaining promises to complete
        if (pendingPromises.length > 0) {
            console.log(`Waiting for ${pendingPromises.length} pending proxy tests to complete...`);
            await Promise.all(pendingPromises);
        }

        // Report results
        console.log("\n=== PROXY TEST RESULTS ===");
        console.log(`Total proxies: ${lineCount}`);
        console.log(`Working proxies: ${successfulProxies.length}`);

        if (successfulProxies.length > 0) {
            console.log("\nTop 10 fastest proxies:");
            successfulProxies
                .sort((a, b) => a.pingTime - b.pingTime)
                .slice(0, 10)
                .forEach((p, i) => {
                    console.log(`${i+1}. ${p.proxy} - ${p.pingTime}ms`);
                });

            // Save working proxies to file
            const workingProxiesFile = "working_proxies.txt";
            fs.writeFileSync(
                workingProxiesFile,
                successfulProxies
                    .map(p => `${p.proxy} # ${p.pingTime}ms`)
                    .join('\n')
            );
            console.log(`\nWorking proxies saved to ${workingProxiesFile}`);
        }

        console.log("✔️ | Time taken for " + lineCount + " proxies: " + et.stop('proxies').preciseWords)
    } catch (error) {
        console.error(`Error in processProxy: ${error.message}`);
        throw error;
    }
}