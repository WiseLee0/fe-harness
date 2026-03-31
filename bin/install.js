#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// ─── 配置 ────────────────────────────────────────────

const CONFIG_DIR = '.claude';
const DIRS = {
  commands: 'commands/fe',
  agents: 'agents',
  runtime: 'fe-harness',
};

// ─── 工具函数 ───────────────────────────────────────────

function logOk(msg) { console.log(`  ✓ ${msg}`); }
function logErr(msg) { console.error(`  ✗ ${msg}`); }

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyDirRecursive(src, dest, pathReplace) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyDirRecursive(srcPath, destPath, pathReplace);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');

      // 替换 .md 文件中的路径引用
      if (entry.name.endsWith('.md') && pathReplace) {
        content = content.replace(/~\/\.claude\/fe-harness\//g, pathReplace);
      }

      fs.writeFileSync(destPath, content, 'utf8');

      // 保留 .cjs 文件的可执行权限
      if (entry.name.endsWith('.cjs')) {
        fs.chmodSync(destPath, 0o755);
      }

      count++;
    }
  }

  return count;
}

// ─── 安装 ───────────────────────────────────────────

function install() {
  const args = process.argv.slice(2);
  const isLocal = args.includes('--local') || args.includes('-l') || args.includes('local');
  const isHelp = args.includes('--help') || args.includes('-h');
  const isUninstall = args.includes('--uninstall') || args.includes('uninstall');
  const isInit = args.includes('init');

  if (isHelp) {
    console.log(`
  fe-harness — Figma 设计稿转代码工具（适用于 Claude Code）

  用法：
    npx fe-harness           全局安装到 ~/.claude/
    npx fe-harness --local   本地安装到 ./.claude/
    npx fe-harness init      在当前目录初始化项目配置
    npx fe-harness uninstall [--local]     卸载已安装的文件

  安装后，可在 Claude Code 中使用以下命令：
    /fe:plan      根据 Figma URL 创建任务计划
    /fe:execute   使用子代理执行所有任务
    /fe:complete  生成完成报告并归档
    /fe:status    查看任务状态
    /fe:help      显示帮助信息
`);
    return;
  }

  if (isInit) {
    return initProject();
  }

  // 确定源目录（此包的安装位置）
  const pkgRoot = path.resolve(__dirname, '..');

  // 确定目标目录
  let targetDir;
  if (isLocal) {
    targetDir = path.join(process.cwd(), CONFIG_DIR);
  } else {
    const home = process.env.HOME || process.env.USERPROFILE;
    targetDir = path.join(home, CONFIG_DIR);
  }

  // 计算 .md 文件中引用的路径前缀
  let pathPrefix;
  if (isLocal) {
    pathPrefix = path.resolve(targetDir, 'fe-harness') + '/';
  } else {
    pathPrefix = '~/.claude/fe-harness/';
  }

  if (isUninstall) {
    return uninstall(targetDir);
  }

  console.log(`\n  ⚡ fe-harness 安装器\n`);
  console.log(`  目标目录：${targetDir}`);
  console.log(`  模式：    ${isLocal ? '本地' : '全局'}\n`);

  // 0. 清理旧版安装
  const cleanDirs = [
    path.join(targetDir, DIRS.commands),
    path.join(targetDir, DIRS.runtime),
  ];
  for (const dir of cleanDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
  const agentCleanDir = path.join(targetDir, DIRS.agents);
  if (fs.existsSync(agentCleanDir)) {
    for (const f of fs.readdirSync(agentCleanDir).filter(f => f.startsWith('fe-'))) {
      fs.unlinkSync(path.join(agentCleanDir, f));
    }
  }
  logOk('已清理旧版安装文件');

  // 1. 复制命令文件
  const cmdSrc = path.join(pkgRoot, 'commands', 'fe');
  const cmdDest = path.join(targetDir, DIRS.commands);
  if (fs.existsSync(cmdSrc)) {
    const count = copyDirRecursive(cmdSrc, cmdDest, pathPrefix);
    logOk(`${count} 个命令文件 → ${DIRS.commands}/`);
  } else {
    logErr(`命令源目录未找到：${cmdSrc}`);
  }

  // 2. 复制代理文件
  const agentSrc = path.join(pkgRoot, 'agents');
  const agentDest = path.join(targetDir, DIRS.agents);
  if (fs.existsSync(agentSrc)) {
    const count = copyDirRecursive(agentSrc, agentDest, pathPrefix);
    logOk(`${count} 个代理文件 → ${DIRS.agents}/`);
  } else {
    logErr(`代理源目录未找到：${agentSrc}`);
  }

  // 3. 复制运行时文件 (fe-harness/)
  const rtSrc = path.join(pkgRoot, 'fe-harness');
  const rtDest = path.join(targetDir, DIRS.runtime);
  if (fs.existsSync(rtSrc)) {
    const count = copyDirRecursive(rtSrc, rtDest, pathPrefix);
    logOk(`${count} 个运行时文件 → ${DIRS.runtime}/`);
  } else {
    logErr(`运行时源目录未找到：${rtSrc}`);
  }

  // 4. 写入版本文件
  let version = 'unknown';
  try {
    const srcPkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    version = srcPkg.version;
  } catch (_) {}
  fs.writeFileSync(path.join(targetDir, DIRS.runtime, 'VERSION'), version, 'utf8');

  console.log(`\n  ✅ fe-harness v${version} 安装成功！\n`);

  // 本地安装：将安装目录加入 .gitignore，避免提交大量文件
  if (isLocal) {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    const ignoreEntries = [
      '.claude/fe-harness/',
      '.claude/commands/fe/',
      '.claude/agents/fe-*',
    ];
    const ignoreBlock = '\n# fe-harness 安装文件（由 npx fe-harness --local 生成）\n'
      + ignoreEntries.join('\n') + '\n';

    if (fs.existsSync(gitignorePath)) {
      const existing = fs.readFileSync(gitignorePath, 'utf8');
      if (!existing.includes('.claude/fe-harness/')) {
        fs.appendFileSync(gitignorePath, ignoreBlock, 'utf8');
        logOk('已将安装目录添加到 .gitignore');
      }
    } else {
      fs.writeFileSync(gitignorePath, ignoreBlock.trimStart(), 'utf8');
      logOk('已创建 .gitignore 并添加安装目录规则');
    }

    initProject();
  } else {
    console.log(`  后续步骤：`);
    console.log(`    1. 进入你的项目目录`);
    console.log(`    2. 运行：npx fe-harness init`);
    console.log(`    3. 编辑 .fe/config.jsonc 配置 devServer 等`);
    console.log(`    4. 使用 /fe:plan 创建任务计划\n`);
  }
}

// ─── 初始化（项目配置）────────────────────────────

function initProject() {
  console.log(`\n  ⚡ fe-harness 项目初始化\n`);

  const pkgRoot = path.resolve(__dirname, '..');
  const feDir = path.join(process.cwd(), '.fe');

  // 1. 从模板创建 .fe/config.jsonc
  const feConfigPath = path.join(feDir, 'config.jsonc');
  if (!fs.existsSync(feConfigPath)) {
    const templatePath = path.join(pkgRoot, 'fe-harness', 'templates', 'config.jsonc');
    if (fs.existsSync(templatePath)) {
      ensureDir(feDir);
      fs.copyFileSync(templatePath, feConfigPath);
      logOk('已创建 .fe/config.jsonc（默认配置）');
    } else {
      logErr('配置模板未找到，请确认 fe-harness 已正确安装');
      return;
    }
  } else {
    logOk('.fe/config.jsonc 已存在，跳过');
  }

  // 2. 创建 .fe-runtime/context/ 目录
  const runtimeDir = path.join(process.cwd(), '.fe-runtime');
  ensureDir(path.join(runtimeDir, 'context'));

  // 3. 将 .fe-runtime/ 添加到 .gitignore
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  const feGitignoreContent = '\n# fe-harness 运行时产物（截图、分析文件、任务状态、临时结果）\n.fe-runtime/\n';
  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    if (!existing.includes('.fe-runtime')) {
      fs.appendFileSync(gitignorePath, feGitignoreContent, 'utf8');
      logOk('已将 .fe-runtime/ 添加到 .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, feGitignoreContent.trimStart(), 'utf8');
    logOk('已创建 .gitignore 并添加 .fe-runtime/ 规则');
  }

  console.log(`\n  ✅ 项目初始化完成！\n`);
  console.log(`  后续步骤：`);
  console.log(`    1. 编辑 .fe/config.jsonc 配置 devServer 等`);
  console.log(`    2. 使用 /fe:plan 创建任务计划`);
  console.log(`    3. 使用 /fe:execute 开始执行\n`);
}

// ─── 卸载 ─────────────────────────────────────────

function uninstall(targetDir) {
  console.log(`\n  🗑️  正在从 ${targetDir} 卸载 fe-harness\n`);

  const dirsToRemove = [
    path.join(targetDir, DIRS.commands),
    path.join(targetDir, DIRS.runtime),
  ];

  // 删除 fe-* 代理文件（不删除整个 agents 目录）
  const agentDir = path.join(targetDir, DIRS.agents);
  if (fs.existsSync(agentDir)) {
    const agents = fs.readdirSync(agentDir).filter(f => f.startsWith('fe-'));
    for (const a of agents) {
      fs.unlinkSync(path.join(agentDir, a));
      logOk(`已删除代理：${a}`);
    }
  }

  for (const dir of dirsToRemove) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
      logOk(`已删除：${path.relative(targetDir, dir)}`);
    }
  }

  console.log(`\n  ✅ fe-harness 已卸载。\n`);
}

// ─── 主入口 ──────────────────────────────────────────

install();
