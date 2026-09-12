type RawMessage = Record<string, unknown>;
interface PublicMessage {
  message_id: number; name: string; role: string; is_hidden: boolean; message: string;
  data: Record<string, unknown>; extra: Record<string, unknown>; swipe_id: number;
  swipes: string[]; swipes_data: Record<string, unknown>[]; swipes_info: Record<string, unknown>[];
}
interface EditedMessage extends RawMessage {
  mes: string; swipes: string[]; variables: Record<string, unknown>[];
  extra: { ste_runtime: Record<string, unknown> };
  swipe_info: { extra: { ste_runtime: Record<string, unknown> } }[];
}
export function helperMessageSource(message: RawMessage): string;
export function helperMessages(chat: RawMessage[]): PublicMessage[];
export function prepareHelperMessageChanges(chat: RawMessage[], patches: unknown[], sources: string[], baselines?: PublicMessage[]): { id: number; message: EditedMessage }[];
