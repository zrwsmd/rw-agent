import { MCPMarketplaceServer, MCPServerConfig } from '../types/mcp';

/**
 * MCP 服务器市场
 */
export class MCPMarketplace {
  private static readonly MARKETPLACE_SERVERS: MCPMarketplaceServer[] = [
    {
      name: 'filesystem',
      displayName: 'File System',
      description: '提供文件系统操作功能，包括读取、写入、搜索文件等',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['filesystem', 'files', 'io'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/directory'],
        description: '文件系统 MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-filesystem',
      },
    },
    {
      name: 'github',
      displayName: 'GitHub',
      description: '与 GitHub API 交互，管理仓库、问题、PR 等',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['github', 'git', 'repository', 'api'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: '',
        },
        description: 'GitHub API MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-github',
      },
    },
    {
      name: 'sqlite',
      displayName: 'SQLite',
      description: '操作 SQLite 数据库，执行查询和管理数据',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['database', 'sqlite', 'sql', 'data'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', '/path/to/database.db'],
        description: 'SQLite 数据库 MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-sqlite',
      },
    },
    {
      name: 'postgres',
      displayName: 'PostgreSQL',
      description: '连接和操作 PostgreSQL 数据库',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['database', 'postgresql', 'sql', 'data'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: {
          POSTGRES_CONNECTION_STRING: '',
        },
        description: 'PostgreSQL 数据库 MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-postgres',
      },
    },
    {
      name: 'brave-search',
      displayName: 'Brave Search',
      description: '使用 Brave Search API 进行网络搜索',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['search', 'web', 'api', 'brave'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: {
          BRAVE_API_KEY: '',
        },
        description: 'Brave Search MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-brave-search',
      },
    },
    {
      name: 'puppeteer',
      displayName: 'Puppeteer',
      description: '使用 Puppeteer 进行网页自动化和截图',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['automation', 'browser', 'puppeteer', 'screenshot'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        description: 'Puppeteer 自动化 MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-puppeteer',
      },
    },
    {
      name: 'slack',
      displayName: 'Slack',
      description: '与 Slack API 交互，发送消息和管理频道',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['slack', 'messaging', 'api', 'communication'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-slack'],
        env: {
          SLACK_BOT_TOKEN: '',
        },
        description: 'Slack API MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-slack',
      },
    },
    {
      name: 'memory',
      displayName: 'Memory',
      description: '提供持久化内存功能，存储和检索信息',
      author: 'Anthropic',
      version: '1.0.0',
      repository: 'https://github.com/modelcontextprotocol/servers',
      tags: ['memory', 'storage', 'persistence', 'knowledge'],
      config: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        description: '内存存储 MCP 服务器',
      },
      requirements: {
        node: '>=18.0.0',
      },
      installation: {
        npm: '@modelcontextprotocol/server-memory',
      },
    },
  ];

  /**
   * 获取所有市场服务器
   */
  public static getMarketplaceServers(): MCPMarketplaceServer[] {
    return [...this.MARKETPLACE_SERVERS];
  }

  /**
   * 根据标签搜索服务器
   */
  public static searchByTags(tags: string[]): MCPMarketplaceServer[] {
    const lowerTags = tags.map(tag => tag.toLowerCase());
    return this.MARKETPLACE_SERVERS.filter(server =>
      server.tags.some(tag => lowerTags.includes(tag.toLowerCase()))
    );
  }

  /**
   * 根据名称搜索服务器
   */
  public static searchByName(query: string): MCPMarketplaceServer[] {
    const lowerQuery = query.toLowerCase();
    return this.MARKETPLACE_SERVERS.filter(server =>
      server.displayName.toLowerCase().includes(lowerQuery) ||
      server.description.toLowerCase().includes(lowerQuery) ||
      server.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * 获取特定服务器
   */
  public static getServer(name: string): MCPMarketplaceServer | undefined {
    return this.MARKETPLACE_SERVERS.find(server => server.name === name);
  }

  /**
   * 将市场服务器转换为配置
   */
  public static toServerConfig(
    marketplaceServer: MCPMarketplaceServer,
    customizations?: Partial<MCPServerConfig>
  ): MCPServerConfig {
    return {
      name: marketplaceServer.name,
      description: marketplaceServer.description,
      ...marketplaceServer.config,
      enabled: true,
      autoStart: true,
      ...customizations,
    };
  }

  /**
   * 验证服务器要求
   */
  public static validateRequirements(server: MCPMarketplaceServer): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (server.requirements?.node) {
      // 这里可以添加 Node.js 版本检查逻辑
      // 暂时跳过实际检查
    }

    if (server.requirements?.python) {
      // 这里可以添加 Python 版本检查逻辑
      // 暂时跳过实际检查
    }

    if (server.requirements?.system) {
      // 这里可以添加系统要求检查逻辑
      // 暂时跳过实际检查
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}