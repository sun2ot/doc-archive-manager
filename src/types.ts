export interface DocumentRecord {
  processingMonths?: string[]; archivedMonths?: string[];
  id: string; title: string; kind: 'incoming' | 'outgoing' | 'request' | 'other'; sender: string; recipient: string; handler: string;
  signedAt: string; receivedAt: string; sentAt: string; number: string; location: string;
  notes: string; tags: string[]; links: string[]; status: 'processing' | 'pending' | 'archived'; archived?: boolean; createdAt: string; updatedAt: string;
}
export interface Department {
  id: string; name: string; parentId: string | null; leaders: string[];
}
export interface Preferences {
  totpEnabled: boolean; webdavUrl: string; webdavUsername: string; hasWebdavPassword: boolean;
  lastBackup: string | null; dataPath: string; locations: string[];
  theme: 'light' | 'dim' | 'dark'; fontZh: string; fontEn: string; accent: string;
  backgroundImage: string; backgroundOpacity: number; fontScale: number;
  autoLockMinutes: number; numberTemplates: string[]; departments: Department[];
}
