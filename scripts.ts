import { supabase } from "./db_actions.ts";

async function getOldVideoIds(): Promise<string[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);

  const { data, error } = await supabase
    .from("video_metadata")
    .select("id")
    .lt("timestamp", cutoffDate.toISOString());

  if (error) {
    throw new Error("Failed to fetch old video IDs.");
  }
  return data.map((video) => video.id);
}

export async function deleteOldVideos() {
  const oldIds = await getOldVideoIds();

  if (oldIds.length === 0) {
    console.log("No old videos found. Exiting.");
    return;
  }
  console.log(`Attempting to delete superchats for ${oldIds.length} videos.`);

  const { error } = await supabase.rpc("delete_old_video_data", {
    old_ids: oldIds,
  });

  if (error) {
    console.error("Transaction failed! All changes rolled back.", error);
    throw new Error("Transactional delete failed.");
  }

  console.log("Successfully deleted old superchats.");
}

export async function getVideoMetadata(videoId: string) {
  const { data, error } = await supabase
    .from("video_metadata")
    .select("timestamp, title, channel_id")
    .eq("id", videoId)
    .maybeSingle();

  if (error) {
    throw Error(error);
  }
  return data;
}

export async function getSuperchatMetrics(videoId: string) {
  const { data, error } = await supabase
    .rpc("get_video_metrics", { target_video_id: videoId })
    .maybeSingle();

  if (error) {
    throw new Error(error);
  }

  return { totalYen: data.total_yen, scCount: data.sc_count } as VideoMetrics;
}

export async function getVideoSuperchats(videoId: string) {
  const { data, error } = await supabase
    .from("superchats")
    .select("id, name,yen_amount, timestamp")
    .eq("video_id", videoId)
    .order("timestamp");

  if (error) {
    throw new Error(error);
  }
  return data;
}

export async function getTopDonors(videoId: string) {
  const { data, error } = await supabase.rpc("get_top_donors", {
    target_video_id: videoId,
  });

  if (error) {
    throw new Error(error);
  }
  return data.map((obj) => ({
    donor_name: obj.name,
    total_yen: obj.yen_amount,
  }));
}

export async function getTimeSeriesMetrics(videoId: string) {
  const { data, error } = await supabase.rpc("get_time_series_metrics", {
    target_video_id: videoId,
  });

  if (error) {
    throw new Error(error);
  }
  return data;
}

export async function getAllVideoIds() {
  const { data, error } = await supabase.from("video_metadata").select("id");

  if (error) {
    throw new Error(error);
  }
  return data;
}

export async function getCachedVideoIds() {
    const { data, error } = await supabase
    .from("video_cache")
    .select("*")
    .limit(1) 
    .maybeSingle()
    return data
  // const { data, error } = await supabase.from("video_cache").select("id");

  if (error) {
    throw new Error(error);
  }
  return data;
}

async function cacheVideos() {
  const allVideoIds = (await getAllVideoIds()).map((obj) => obj.id);
  const alreadyCachedVideoIds = (await getCachedVideoIds()).map(
    (obj) => obj.id
  );
  const cachedIdSet = new Set(alreadyCachedVideoIds);

  const uncachedVideoIds = allVideoIds.filter(
    (videoId) => !cachedIdSet.has(videoId)
  );
  console.log(`Total videos found: ${allVideoIds.length}`);
  console.log(`Videos already cached: ${alreadyCachedVideoIds.length}`);
  console.log(`Videos to process and cache: ${uncachedVideoIds.length}`);

  if (uncachedVideoIds.length === 0) {
    console.log("no videos to cache");
    return;
  }
  for (const videoId of uncachedVideoIds) {
    console.log(`Processing ${videoId}`);
    const videoMetaData = await getVideoMetadata(videoId);
    const superchatMetrics = await getSuperchatMetrics(videoId);
    const superchats = await getVideoSuperchats(videoId);
    const topDonors = await getTopDonors(videoId);
    const cumSums = await getTimeSeriesMetrics(videoId);

    const cacheRecord = {
      id: videoId,
      metadata: videoMetaData,
      metrics: superchatMetrics,
      superchats: superchats,
      top_donors: topDonors,
      timeseries: cumSums,
      last_updated: new Date().toISOString(),
    };

    const { error } = await supabase.from("video_cache").upsert(cacheRecord);

    if (error) {
      console.error(`Error upserting cache for video ${videoId}:`, error);
    } else {
      console.log(`Successfully cached video ID: ${videoId}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (import.meta.main) {
  const a = await getCachedVideoIds()
  console.log({a})
  // cacheVideos();
}
