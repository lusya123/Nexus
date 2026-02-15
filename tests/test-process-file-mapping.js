#!/usr/bin/env node
/**
 * 测试：验证进程到文件的精确映射
 *
 * 目标：使用 lsof 检查 Claude Code 进程打开的 .jsonl 文件
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getProcessOpenFiles(pid) {
  try {
    // 获取进程打开的所有文件
    const { stdout } = await execAsync(`lsof -p ${pid} 2>/dev/null`);

    // 过滤出 .jsonl 文件
    const lines = stdout.split('\n');
    const jsonlFiles = lines
      .filter(line => line.includes('.jsonl') && !line.includes('.jsonl.lock'))
      .map(line => {
        // lsof 输出格式：COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
        const parts = line.trim().split(/\s+/);
        const name = parts[parts.length - 1];
        const fd = parts[3];
        return { file: name, fd, line };
      });

    return jsonlFiles;
  } catch (error) {
    return [];
  }
}

async function findClaudeProcesses() {
  try {
    const { stdout } = await execAsync(`ps aux | grep " claude" | grep -v grep | grep -v "node "`);
    const lines = stdout.trim().split('\n').filter(line => line.trim());

    const processes = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[1];
      const command = parts.slice(10).join(' ');

      processes.push({ pid, command });
    }

    return processes;
  } catch (error) {
    return [];
  }
}

async function main() {
  console.log('🔍 查找 Claude Code 进程...\n');

  const processes = await findClaudeProcesses();

  if (processes.length === 0) {
    console.log('❌ 未找到运行中的 Claude Code 进程');
    console.log('提示：请先启动一个 Claude Code session');
    return;
  }

  console.log(`✅ 找到 ${processes.length} 个 Claude Code 进程\n`);

  for (const proc of processes) {
    console.log(`📌 PID ${proc.pid}`);
    console.log(`   命令: ${proc.command.substring(0, 80)}...`);

    const openFiles = await getProcessOpenFiles(proc.pid);

    if (openFiles.length === 0) {
      console.log(`   ⚠️  未检测到打开的 .jsonl 文件`);
      console.log(`   原因可能：`);
      console.log(`     - 进程刚启动，还未创建 session 文件`);
      console.log(`     - lsof 权限不足`);
      console.log(`     - 文件已关闭（批量写入模式）`);
    } else {
      console.log(`   ✅ 打开的 .jsonl 文件 (${openFiles.length} 个):`);
      openFiles.forEach(({ file, fd }) => {
        console.log(`      [FD ${fd}] ${file}`);
      });
    }

    console.log('');
  }

  console.log('\n💡 结论：');
  console.log('   - 如果能检测到打开的 .jsonl 文件 → 可以精确映射进程到 session');
  console.log('   - 如果检测不到 → 需要依赖当前的启发式方法（最新 N 个文件）');
}

main().catch(console.error);
