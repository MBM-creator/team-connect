import {
  JOB_NOTE_IMAGE_MAX_BYTES,
  JOB_NOTE_IMAGE_MIME_TYPES,
  JOB_NOTE_VIDEO_MAX_BYTES,
  JOB_NOTE_VIDEO_MAX_SECONDS,
  JOB_NOTE_VIDEO_MIME_TYPES,
  isAllowedJobNoteImageMimeType,
  isAllowedJobNoteVideoMimeType,
  type JobNoteImageMimeType,
  type JobNoteVideoMimeType,
} from '@/lib/job-notes';

export const JOB_MEDIA_IMAGE_MAX_BYTES = JOB_NOTE_IMAGE_MAX_BYTES;
export const JOB_MEDIA_VIDEO_MAX_BYTES = JOB_NOTE_VIDEO_MAX_BYTES;
export const JOB_MEDIA_VIDEO_MAX_SECONDS = JOB_NOTE_VIDEO_MAX_SECONDS;
export const JOB_MEDIA_MAX_PER_JOB = 200;

export const JOB_MEDIA_IMAGE_MIME_TYPES = JOB_NOTE_IMAGE_MIME_TYPES;
export const JOB_MEDIA_VIDEO_MIME_TYPES = JOB_NOTE_VIDEO_MIME_TYPES;

export type JobMediaImageMimeType = JobNoteImageMimeType;
export type JobMediaVideoMimeType = JobNoteVideoMimeType;

export const isAllowedJobMediaImageMimeType = isAllowedJobNoteImageMimeType;
export const isAllowedJobMediaVideoMimeType = isAllowedJobNoteVideoMimeType;
