export interface PushNotificationToken {
  id: number;
  user_id: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
