/**
 * 用户域 Mongoose Schema（A1-W1）。
 * 设计依据：A1 §五 集合 user_profile / feedback。
 */
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
class ExternalIdentity {
  /** union type 用 string 存储（tsx 不支持 emitDecoratorMetadata，§8） */
  @Prop({ required: true }) provider!: string;
  @Prop({ required: true }) externalId!: string;
}
const ExternalIdentitySchema = SchemaFactory.createForClass(ExternalIdentity);

@Schema({ collection: 'user_profile', timestamps: true })
export class UserProfile {
  @Prop({ required: true, unique: true, index: true }) userId!: string;
  @Prop({ unique: true, sparse: true, index: true }) phoneHash?: string;
  @Prop() nameHash?: string;
  @Prop({ type: [ExternalIdentitySchema], default: [] }) externalIdentities!: ExternalIdentity[];
  @Prop({ type: Object, default: {} }) legalPreferences!: Record<string, unknown>;
  @Prop() privacyAcceptedVersion?: string;
  @Prop() lastActiveAt?: Date;
}
export type UserProfileDocument = HydratedDocument<UserProfile>;
export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);

@Schema({ collection: 'feedback', timestamps: true })
export class Feedback {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) type!: string;
  @Prop() relatedMsgId?: string;
  @Prop({ required: true }) content!: string;
  @Prop() contact?: string;
  @Prop({ default: 'open', index: true }) status!: string;
  @Prop() assignee?: string;
}
export type FeedbackDocument = HydratedDocument<Feedback>;
export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
