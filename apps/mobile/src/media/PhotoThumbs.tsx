import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { getBaseUrl, getToken } from '../api/client';
import { isPhotoRef, normalizePhotos } from './photos';
import { getPhotoUploadStatus, onPhotoUploadStatus, type PhotoUploadStatus } from './uploader';

/** Thumbnails for a record's photos: local URIs render from the device, uploaded ones from the API (Bearer). */
export function PhotoThumbs({ photos, size = 44, onPress }: { photos: unknown; size?: number; onPress?: (uri: string) => void }) {
  const list = normalizePhotos(photos);
  if (!list.length) return null;
  const token = getToken();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
      {list.map((p) => {
        const source = isPhotoRef(p) ? { uri: `${getBaseUrl()}${p.url}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined } : { uri: p };
        const key = isPhotoRef(p) ? p.mediaId : p;
        return (
          <Pressable key={key} onPress={() => onPress?.(source.uri)} accessibilityLabel={isPhotoRef(p) ? 'Uploaded photo' : 'Photo waiting to upload'}>
            <Image source={source} style={{ width: size, height: size, borderRadius: 6, opacity: isPhotoRef(p) ? 1 : 0.6 }} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function usePhotoUploadStatus(): PhotoUploadStatus {
  const [s, setS] = useState(getPhotoUploadStatus());
  useEffect(() => {
    const off = onPhotoUploadStatus(setS);
    return () => {
      off();
    };
  }, []);
  return s;
}

/** One-line summary of the background upload queue. */
export function PhotoUploadLine({ status, color }: { status: PhotoUploadStatus; color: string }) {
  const waiting = status.pending + status.waiting;
  if (!waiting && !status.failed && !status.running) return null;
  const parts = [
    status.running ? 'Uploading photos…' : waiting ? `${waiting} photo${waiting === 1 ? '' : 's'} waiting to upload` : '',
    status.failed ? `${status.failed} could not be uploaded` : '',
  ].filter(Boolean);
  return <Text style={{ color, fontSize: 13 }}>{parts.join(' · ')}</Text>;
}
