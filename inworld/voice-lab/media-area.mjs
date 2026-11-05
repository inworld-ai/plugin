import {MEDIA_CATALOG_TOOLS,createMediaCatalog} from './media-common.mjs';
import {IMAGE_TOOLS,createImageTools} from './media-image.mjs';
import {VIDEO_TOOLS,createVideoTools} from './media-video.mjs';
export function createArea({apiBase}) {
 const catalog=createMediaCatalog({apiBase}),image=createImageTools({apiBase}),video=createVideoTools({apiBase});
 return {tools:[...MEDIA_CATALOG_TOOLS,...IMAGE_TOOLS,...VIDEO_TOOLS],handlers:{
 list_media_models:(a,k)=>catalog.listMediaModels(a,k),generate_image:(a,k)=>image.generateImage(a,k),
 create_video:(a,k)=>video.createVideo(a,k),get_video:(a,k)=>video.getVideo(a,k),list_videos:(a,k)=>video.listVideos(a,k),
 cancel_video:(a,k)=>video.cancelVideo(a,k),download_video:(a,k)=>video.downloadVideo(a,k),
 }};
}
