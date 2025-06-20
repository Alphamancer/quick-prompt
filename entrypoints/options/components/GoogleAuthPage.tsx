import React, { useState, useEffect, useRef } from 'react';
import { browser } from '#imports';
import { t } from '../../../utils/i18n';

interface UserInfo {
  email: string;
  name: string;
  id?: string;
}

const GoogleAuthPage: React.FC = () => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const periodicCheckerRef = useRef<number | null>(null);

  // 检查用户的登录状态
  useEffect(() => {
    checkAuthStatus();
    
    // 监听认证状态变化
    const authStatusIntervalId = monitorAuthStatus();
    
    // 设置轮询检查登录状态
    startPeriodicAuthCheck();
    
    // 在组件卸载时清除定时器
    return () => {
      stopPeriodicAuthCheck();
      
      // 清除监听认证状态的定时器
      if (authStatusIntervalId) {
        window.clearInterval(authStatusIntervalId);
      }
    };
  }, []);
  
  // 开始定期检查登录状态
  const startPeriodicAuthCheck = () => {
    // 每10秒检查一次登录状态
    periodicCheckerRef.current = window.setInterval(async () => {
      const result = await browser.storage.local.get('google_user_info');
      // 只有状态有变化时才更新
      if ((result.google_user_info && !user) || 
          (!result.google_user_info && user)) {
        console.log(t('loginStatusChanged'));
        if (result.google_user_info) {
          setUser(result.google_user_info);
          setError(null);
        } else {
          setUser(null);
        }
      }
    }, 10000);
  };
  
  // 停止定期检查
  const stopPeriodicAuthCheck = () => {
    if (periodicCheckerRef.current) {
      window.clearInterval(periodicCheckerRef.current);
      periodicCheckerRef.current = null;
    }
  };

  const checkAuthStatus = async () => {
    setIsLoading(true);
    try {
      // 从本地存储获取用户信息
      const result = await browser.storage.local.get('google_user_info');
      if (result.google_user_info) {
        setUser(result.google_user_info);
        setError(null); // 清除任何错误状态
        console.log(t('foundLoggedInUser'), result.google_user_info);
        return true;
      }
      return false;
    } catch (error) {
      console.error(t('checkAuthStatusError'), error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log(t('attemptGoogleLogin'));
      
      // 背景脚本将设置 'google_auth_status' 为 'in_progress'.
      // monitorAuthStatus 将会捕捉此状态并显示相应信息.
      await browser.runtime.sendMessage({
        action: 'authenticateWithGoogle',
        interactive: true
      });
      
      // UI更新将由monitorAuthStatus在检测到 'google_auth_status' === 'success' 时触发，
      // 然后调用 checkAuthStatus。
      // 注意：setIsLoading(false) 将由 monitorAuthStatus 或 checkAuthStatus 内部处理。

    } catch (e: any) {
      // 此处主要捕获发送消息本身的错误
      const errorMessage = e?.message || t('loginProcessError');
      setError(errorMessage);
      console.error(t('googleLoginRequestError'), e);
      setIsLoading(false); // 在发送错误时确保停止加载
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      console.log(t('loggingOutGoogle'));
      
      // 发送登出请求
      browser.runtime.sendMessage({ action: 'logoutGoogle' }).catch(e => {
        console.error(t('logoutRequestError'), e);
      });
      
      // 创建一个登出状态检查函数，等待用户信息被清除
      const checkUntilLoggedOut = async (maxAttempts = 5) => {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          // 等待一小段时间
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 检查用户是否已经登出
          const result = await browser.storage.local.get('google_user_info');
          if (!result.google_user_info) {
            console.log(t('confirmedLogout'));
            setUser(null);
            return true;
          }
          
          console.log(t('logoutCheckAttempt', [(attempt + 1).toString(), maxAttempts.toString()]));
        }
        
        return false;
      };
      
      // 开始检查登出状态
      const loggedOut = await checkUntilLoggedOut();
      
      if (loggedOut) {
        console.log(t('googleLogoutSuccess'));
      } else {
        // 即使检查失败，也尝试清除本地状态
        setUser(null);
        setError(t('logoutMaybeIncomplete'));
        console.warn(t('logoutProcessIncomplete'));
      }
    } catch (e: any) {
      const errorMessage = e?.message || t('logoutProcessError');
      setError(errorMessage);
      console.error(t('googleLogoutRequestError'), e);
    } finally {
      setIsLoading(false);
    }
  };
  
  // 监控认证状态变化
  const monitorAuthStatus = () => {
    // 设置状态变化检测
    const checkInterval = window.setInterval(async () => {
      try {
        const result = await browser.storage.local.get('google_auth_status');
        if (result.google_auth_status) {
          const status = result.google_auth_status.status;
          const timestamp = result.google_auth_status.timestamp;
          
          // 只处理最近5分钟内的状态更新
          const isRecent = (Date.now() - timestamp) < 5 * 60 * 1000;
          
          if (isRecent) {
            switch (status) {
              case 'in_progress':
                // isLoading 应该在 handleLogin 开始时设置，此处可选择性更新error提示
                setError(t('loginInProgress'));
                setIsLoading(true); // 确保在轮询到in_progress时也显示loading
                break;
              case 'checking_session':
                setError(t('checkingLoginSession'));
                setIsLoading(true);
                break;
              case 'success':
                await checkAuthStatus(); // 这会更新用户状态并可能设置isLoading(false)
                await browser.storage.local.remove('google_auth_status');
                setError(null); // 清除之前的提示信息
                setIsLoading(false); // 明确停止加载
                break;
              case 'failed':
                setError(t('loginFailedTryAgain'));
                await browser.storage.local.remove('google_auth_status');
                setIsLoading(false);
                break;
              case 'error':
                setError(t('loginErrorTryLater'));
                await browser.storage.local.remove('google_auth_status');
                setIsLoading(false);
                break;
            }
          }
        }
      } catch (err) {
        console.error(t('monitorAuthStatusError'), err);
        // 发生监控错误时，也应该停止加载，避免UI卡死
        // setIsLoading(false); // 考虑是否添加，可能导致错误状态下loading提前消失
      }
    }, 1000); // 每秒检查一次
    
    // 在useEffect的返回函数中会调用clearInterval
    return checkInterval;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-10">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-gray-900 via-blue-900 to-indigo-900 dark:from-gray-100 dark:via-blue-100 dark:to-indigo-100 bg-clip-text text-transparent">
              {t('googleAuth')}
            </h1>
          </div>
          <p className="text-lg text-gray-600 dark:text-gray-300 max-w-3xl">
            {t('googleAuthDescription')}
          </p>
        </div>
        
        {/* 认证卡片 */}
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-white/20 dark:border-gray-700/50 shadow-xl rounded-2xl p-8 mb-8">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('accountAuthentication')}</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('googleAuthDescription')}
          </p>
          
          <div className="max-w-md mx-auto">
            {isLoading ? (
              <div className="flex justify-center my-6">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            ) : user ? (
              <div className="flex flex-col items-center p-6 bg-gray-50/80 dark:bg-gray-700/80 backdrop-blur-sm rounded-xl border border-gray-200/50 dark:border-gray-600/50">
                <div className="w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center mb-3">
                  <span className="text-blue-600 dark:text-blue-200 text-2xl font-bold">
                    {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-center">
                  <h3 className="font-medium text-gray-800 dark:text-gray-200">{user.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{user.email}</p>
                  <button
                    onClick={handleLogout}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                    </svg>
                    {t('logoutGoogle')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 dark:border-gray-700 text-sm font-medium rounded-md shadow-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  <path d="M1 1h22v22H1z" fill="none" />
                </svg>
                {t('useGoogleLogin')}
              </button>
            )}
            
            {error && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-md">
                <p className="flex items-center">
                  <svg className="w-5 h-5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </p>
              </div>
            )}
          </div>
        </div>
        
        {/* 介绍部分 */}
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-white/20 dark:border-gray-700/50 shadow-xl rounded-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('googleAuthExplanation')}</h2>
          <div className="space-y-4 text-gray-600 dark:text-gray-400">
            <p>{t('googleAuthBenefits')}</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>{t('secureCloudStorage')}</li>
              <li>{t('crossDeviceAccess')}</li>
              <li>{t('googleServiceIntegration')}</li>
            </ul>
            <p>{t('privacyAssurance')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuthPage; 