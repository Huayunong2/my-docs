export function wallpaperConnectionMessage(status: number, hasCache: boolean): string {
  let message: string;
  if (status === 404) {
    message = "服务器可达，但没有壁纸同步接口。请先更新并重启服务端，再重试壁纸同步。";
  } else if (status === 401) {
    message = "服务器可达，但访问令牌无效或未填写。请到设置的连接页重新保存令牌。";
  } else if (status === 403) {
    message = "服务器拒绝当前网页来源；请检查服务端 CORS 允许来源配置。";
  } else if (status === 0) {
    message = "无法连接服务器；请检查服务器地址、网络或服务状态。";
  } else if (status >= 500) {
    message = `服务器可达，但壁纸接口返回 HTTP ${status}。请检查服务端状态后重试。`;
  } else {
    message = `壁纸同步请求失败（HTTP ${status}）。请检查连接设置后重试。`;
  }
  return hasCache ? message + " 当前显示此服务器在本机的缓存，设置为只读。" : message;
}
