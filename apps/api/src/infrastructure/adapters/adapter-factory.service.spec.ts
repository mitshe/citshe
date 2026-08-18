import { Test, TestingModule } from '@nestjs/testing';
import { AdapterFactoryService } from './adapter-factory.service';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { EncryptionService } from '../../shared/encryption/encryption.service';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

describe('AdapterFactoryService', () => {
  let service: AdapterFactoryService;
  const testKey = randomBytes(32).toString('hex');

  const mockPrismaService = {
    integration: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    aICredential: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdapterFactoryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        EncryptionService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'ENCRYPTION_KEY') return testKey;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AdapterFactoryService>(AdapterFactoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createGitProvider', () => {
    it('should create GitHub adapter', () => {
      const adapter = service.createGitProvider('GITHUB', {
        accessToken: 'ghp_token',
      });
      expect(adapter).toBeDefined();
    });

    it('should throw for unknown git provider', () => {
      expect(() => service.createGitProvider('UNKNOWN', {})).toThrow(
        'Unknown git provider type',
      );
    });
  });

  describe('createAIProvider', () => {
    it('should create Claude adapter', () => {
      const adapter = service.createAIProvider('CLAUDE', {
        apiKey: 'sk-ant-key',
      });
      expect(adapter).toBeDefined();
    });

    it('should create Claude Code Local adapter', () => {
      const adapter = service.createAIProvider('CLAUDE_CODE_LOCAL', {
        apiKey: 'local',
      });
      expect(adapter).toBeDefined();
    });

    it('should throw for unknown AI provider', () => {
      expect(() =>
        service.createAIProvider('UNKNOWN', { apiKey: 'key' }),
      ).toThrow('Unknown AI provider type');
    });
  });

  describe('testIntegrationConnection', () => {
    it('should return error for unknown integration type', async () => {
      const result = await service.testIntegrationConnection('UNKNOWN', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown integration type');
    });
  });
});
