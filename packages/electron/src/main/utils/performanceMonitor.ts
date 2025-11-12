import { app } from 'electron';

let lastCpuUsage = process.cpuUsage();
let lastTime = Date.now();
let performanceInterval: NodeJS.Timeout | null = null;

export function startPerformanceMonitoring() {
    performanceInterval = setInterval(() => {
        const currentTime = Date.now();
        const currentCpuUsage = process.cpuUsage();

        const timeDiff = currentTime - lastTime;
        const userDiff = currentCpuUsage.user - lastCpuUsage.user;
        const systemDiff = currentCpuUsage.system - lastCpuUsage.system;

        const cpuPercent = ((userDiff + systemDiff) / (timeDiff * 1000)) * 100;

        if (cpuPercent > 10) {
            console.log('[PERF] High CPU usage:', JSON.stringify({
                cpu: `${cpuPercent.toFixed(1)}%`,
                memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
                handles: process._getActiveHandles?.()?.length || 'N/A',
                requests: process._getActiveRequests?.()?.length || 'N/A'
            }));

            // Log what timers are active
            const timers = (global as any)._registeredTimers;
            if (timers) {
                console.log('[PERF] Active timers:', Object.keys(timers));
            }
        }

        lastCpuUsage = currentCpuUsage;
        lastTime = currentTime;
    }, 5000); // Check every 5 seconds
}

export function stopPerformanceMonitoring() {
    if (performanceInterval) {
        clearInterval(performanceInterval);
        performanceInterval = null;
    }
}
