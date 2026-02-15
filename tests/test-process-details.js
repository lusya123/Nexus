#!/usr/bin/env node
/**
 * 测试：检查 Claude Code 进程的详细信息
 * 目标：查找可能包含 session ID 的线索
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

async function getProcessDetails(pid) {
  try {
    // 获取完整的命令行参数
    const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o command=`);

    // 获取环境变量
    let envVars = {};
    try {
      const { stdout: envOutput } = await execAsync(`ps eww ${pid} | tr ' ' '\\n' | grep '='`);
      const lines = envOutput.split('\n').filter(line => line.includes('='));
      lines.forEach(line => {
        const [key, ...valueParts] = line.split('=');
        envVars[key] = valueParts.join('=');
      });
    } catch (e) {
      // 环境变量获取失败
    }

    // 获取工作目录
    let cwd = null;
    try {
      const { stdout: lsofOutput } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd`);
      const cwdMatch = lsofOutput.match(/cwd\s+DIR\s+\S+\s+\S+\s+\S+\s+(.+)$/m);
      if (cwdMatch) {
        cwd = cwdMatch[1].trim();
      }
    } catch (e) {
      // lsof 失败
    }

    return {
      command: psOutput.trim(),
      cwd,
      envVars
    };
  } catch (error) {
    return null;
  }
}

async function checkProjectDirSessions(cwd) {
  if (!cwd) return null;

  // 编码 cwd 到项目目录
  const encodedCwd = cwd.replace(/\//g, '-');
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', encodedCwd);

  if (!fs.existsSync(projectDir)) {
    return { projectDir, exists: false };
  }

  // 统计 session 文件
  const files = fs.readdirSync(projectDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  // 获取最近修改的文件
  const filesWithTime = jsonlFiles.map(f => {
    const filePath = path.join(projectDir, f);
    const stat = fs.statSync(filePath);
    return {
      name: f,
      mtime: stat.mtime,
      mtimeMs: stat.mtimeMs,
      ageSeconds: (Date.now() - stat.mtimeMs) / 1000
    };
  });

  filesWithTime.sort((a, b) => b.mtimeMs - a.mtimeMs);

  return {
    projectDir,
    exists: true,
    totalSessions: jsonlFiles.length,
    recentSessions: filesWithTime.slice(0, 5).map(f => ({
      name: f.name,
      ageSeconds: Math.round(f.ageSeconds)
    }))
  };
}

async function main() {
  console.log('🔍 分析 Claude Code 进程详情...\n');

  const { stdout } = await execAsync(`ps aux | grep " claude" | grep -v grep | grep -v "node " | head -5`);
  const lines = stdout.trim().split('\n').filter(line => line.trim());

  if (lines.length === 0) {
    console.log('❌ 未找到 Claude Code 进程');
    return;
  }

  console.log(`✅ 分析前 ${lines.length} 个进程\n`);

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[1];

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📌 PID ${pid}`);
    console.log(`${'='.repeat(80)}`);

    const details = await getProcessDetails(pid);
    if (!details) {
      console.log('⚠️  无法获取进程详情');
      continue;
    }

    console.log(`\n命令行：`);
    console.log(`  ${details.command.substring(0, 120)}${details.command.length > 120 ? '...' : ''}`);

    console.log(`\n工作目录：`);
    console.log(`  ${details.cwd || '(无法获取)'}`);

    // 检查项目目录
    if (details.cwd) {
      const sessionInfo = await checkProjectDirSessions(details.cwd);
      if (sessionInfo) {
        console.log(`\n项目目录：`);
        console.log(`  ${sessionInfo.projectDir}`);

        if (sessionInfo.exists) {
          console.log(`\nSession 文件统计：`);
          console.log(`  总数: ${sessionInfo.totalSessions} 个`);
          console.log(`  最近修改的 5 个：`);
          sessionInfo.recentSessions.forEach((s, i) => {
            const ageStr = s.ageSeconds < 60
              ? `${s.ageSeconds}秒前`
              : s.ageSeconds < 3600
              ? `${Math.round(s.ageSeconds / 60)}分钟前`
              : `${Math.round(s.ageSeconds / 3600)}小时前`;
            console.log(`    ${i + 1}. ${s.name} (${ageStr})`);
          });

          // 分析遗漏风险
          if (sessionInfo.totalSessions > 25) {
            console.log(`\n⚠️  遗漏风险：`);
            console.log(`    该目录有 ${sessionInfo.totalSessions} 个 session 文件`);
            console.log(`    当前优先使用 lsof 提取该 PID 打开的 .jsonl 文件`);
            console.log(`    如果无法提取（权限/实现差异），退化为每个活跃目录只加载最新 1 个 JSONL`);
          }
        } else {
          console.log(`  ❌ 目录不存在`);
        }
      }
    }

    // 检查环境变量中是否有 session 相关信息
    const sessionEnvVars = Object.keys(details.envVars).filter(k =>
      k.toLowerCase().includes('session') ||
      k.toLowerCase().includes('claude') ||
      k.toLowerCase().includes('project')
    );

    if (sessionEnvVars.length > 0) {
      console.log(`\n相关环境变量：`);
      sessionEnvVars.forEach(key => {
        const value = details.envVars[key];
        console.log(`  ${key}=${value.substring(0, 80)}${value.length > 80 ? '...' : ''}`);
      });
    }
  }

  console.log(`\n\n${'='.repeat(80)}`);
  console.log('💡 结论：');
  console.log(`${'='.repeat(80)}`);
  console.log('1. Claude Code 不保持 .jsonl 文件打开（批量写入模式）');
  console.log('2. 无法通过 lsof 精确映射进程到 session 文件');
  console.log('3. 当前方法：进程 → cwd → 项目目录 → lsof 提取打开的 .jsonl（否则每目录取最新 1 个）');
  console.log('4. 风险：如果 lsof 不可用，只能近似映射到“该目录最新 1 个 JSONL”');
  console.log('\n建议改进：');
  console.log('  - 改为加载"最近 N 分钟内修改的所有文件"');
  console.log('  - 或者降低文件数量限制（25 → 3），减少误报');
}

main().catch(console.error);
