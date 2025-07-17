import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { fileService } from '../services/fileService';
import { api } from '../services/api';
import { FileSpreadsheet, BarChart3, Activity, TrendingUp } from 'lucide-react';

const DashboardContext = createContext();

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};

export const DashboardProvider = ({ children }) => {
  const [dashboardStats, setDashboardStats] = useState({
    totalFiles: 0,
    totalAnalyses: 0,
    totalDataPoints: 0,
    totalSize: 0
  });

  // Upload counter state - persisted in localStorage
  const [uploadCount, setUploadCount] = useState(() => {
    const savedCount = localStorage.getItem('uploadCount');
    return savedCount ? parseInt(savedCount, 10) : 0;
  });

  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Format storage size utility
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 KB';
    const k = 1024;
    const sizes = ['KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Format number utility
  const formatNumber = (num) => {
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  };

  // Fetch and update dashboard statistics
  const updateDashboardStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('📊 Updating dashboard stats...');
      
      // First try to get stats from dedicated endpoint
      let totalFiles = 0;
      let totalSize = 0;
      let totalDataPoints = 0;
      let files = [];
      
      try {
        console.log('📊 Trying dedicated stats endpoint...');
        const statsResponse = await fileService.getFileStats();
        console.log('📊 Stats endpoint response:', statsResponse);
        
        if (statsResponse && statsResponse.stats) {
          totalFiles = statsResponse.stats.totalFiles || 0;
          totalSize = statsResponse.stats.totalSize || 0;
          totalDataPoints = statsResponse.stats.totalDataPoints || statsResponse.stats.totalRows || 0;
          console.log('📊 Using stats from dedicated endpoint:', { totalFiles, totalSize, totalDataPoints });
        }
      } catch (statsError) {
        console.warn('📊 Stats endpoint failed, falling back to individual file calculation:', statsError);
      }
      
      // If stats endpoint failed or returned no data, calculate from individual files
      if (totalFiles === 0) {
        console.log('📊 Calculating stats from individual files...');
        const filesResponse = await fileService.getFiles();
        files = filesResponse.files || [];
        
        console.log('📁 Files fetched:', files.length);
        console.log('📁 Full filesResponse:', filesResponse);
        
        // Log first few files to understand structure
        if (files.length > 0) {
          console.log('📁 First file structure:', files[0]);
          console.log('📁 First file keys:', Object.keys(files[0]));
        }
        
        // Calculate totals from files
        totalFiles = files.length;
        totalSize = files.reduce((sum, file) => {
          const fileSize = file.fileSize || file.size || 0;
          const fileName = file.originalName || file.name || 'Unknown';
          const fileRows = file.totalRows || file.rows || 0;
          console.log(`📁 File ${fileName}: size=${fileSize}, rows=${fileRows}`);
          return sum + fileSize;
        }, 0);
        totalDataPoints = files.reduce((sum, file) => {
          return sum + (file.totalRows || file.rows || 0);
        }, 0);
        
        console.log('📈 Stats calculated from files:', { totalFiles, totalSize, totalDataPoints });
      } else {
        // Still fetch files for recent activity
        try {
          const filesResponse = await fileService.getFiles();
          files = filesResponse.files || [];
        } catch (filesError) {
          console.warn('Failed to fetch files for recent activity:', filesError);
          files = [];
        }
      }
      
      // Fetch analyses stats separately
      let totalAnalyses = 0;
      try {
        const analysesResponse = await api.get('/analytics/stats');
        totalAnalyses = analysesResponse.data.stats?.totalAnalyses || 0;
      } catch (analysesError) {
        console.warn('Failed to fetch analyses stats:', analysesError);
        // Fallback: just set to 0 if analyses endpoint fails
        totalAnalyses = 0;
      }
      
      const newStats = {
        totalFiles,
        totalAnalyses,
        totalDataPoints,
        totalSize
      };
      
      console.log('✅ New dashboard stats:', newStats);
      
      setDashboardStats(newStats);

      // Update recent activity
      const activities = files.slice(0, 4).map(file => ({
        action: `Uploaded ${file.originalName}`,
        time: new Date(file.createdAt || file.uploadedAt).toLocaleDateString(),
        type: 'upload'
      }));
      
      setRecentActivity(activities);
      
      return {
        totalFiles,
        totalAnalyses,
        totalDataPoints,
        totalSize,
        activities
      };
    } catch (error) {
      console.error('❌ Error updating dashboard stats:', error);
      setError('Failed to load dashboard data');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Function to force refresh stats (called after file upload or analysis creation)
  const forceUpdateStats = useCallback(async () => {
    console.log('🔄 Force updating dashboard stats...');
    await updateDashboardStats();
  }, [updateDashboardStats]);

  // Function to refresh with multiple attempts for better reliability
  const refreshDashboardWithRetry = useCallback(async (attempts = 3) => {
    for (let i = 0; i < attempts; i++) {
      try {
        console.log(`🔄 Refresh attempt ${i + 1}/${attempts}`);
        await updateDashboardStats();
        break;
      } catch (error) {
        console.error(`❌ Refresh attempt ${i + 1} failed:`, error);
        if (i === attempts - 1) {
          console.error('❌ All refresh attempts failed');
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
  }, [updateDashboardStats]);

  // Notify about new file upload
  const notifyFileUploaded = useCallback(async (fileData) => {
    console.log('🔔 File uploaded notification:', fileData);
    
    // Increment upload count
    setUploadCount((prevCount) => {
      const newCount = prevCount + 1;
      localStorage.setItem('uploadCount', newCount);
      return newCount;
    });

    // Add to recent activity immediately
    const newActivity = {
      action: `Uploaded ${fileData?.originalName || 'file'}`,
      time: new Date().toLocaleDateString(),
      type: 'upload'
    };
    
    setRecentActivity(prev => [newActivity, ...prev.slice(0, 3)]);
    
    // Force refresh dashboard stats multiple times to ensure backend processing is complete
    const refreshStats = async (attempt = 1) => {
      try {
        console.log(`🔄 Refreshing stats attempt ${attempt}...`);
        await forceUpdateStats();
        console.log('✅ Dashboard stats refreshed after file upload');
      } catch (error) {
        console.error(`❌ Error refreshing dashboard stats (attempt ${attempt}):`, error);
      }
    };
    
    // Immediate refresh
    await refreshStats(1);
    
    // Delayed refreshes to account for backend processing time
    setTimeout(() => refreshStats(2), 1000);  // 1 second
    setTimeout(() => refreshStats(3), 3000);  // 3 seconds
    setTimeout(() => refreshStats(4), 6000);  // 6 seconds
    setTimeout(() => refreshStats(5), 10000); // 10 seconds
    
  }, [forceUpdateStats]);

  // Notify about new analysis creation
  const notifyAnalysisCreated = useCallback(async (analysisData) => {
    console.log('🔔 Analysis created notification:', analysisData);
    
    // Force refresh dashboard stats after analysis creation
    await forceUpdateStats();
    
    // Add to recent activity
    const newActivity = {
      action: `Created analysis: ${analysisData.name}`,
      time: new Date().toLocaleDateString(),
      type: 'analysis'
    };
    
    setRecentActivity(prev => [newActivity, ...prev.slice(0, 3)]);
  }, [forceUpdateStats]);

  // Generate formatted stats for display
  const getFormattedStats = () => {
    return [
      {
        title: 'Files Uploaded',
        value: uploadCount.toString(),
        change: '+0%',
        icon: FileSpreadsheet,
        color: 'blue'
      },
      {
        title: 'Analyses Created',
        value: dashboardStats.totalAnalyses.toString(),
        change: '+0%',
        icon: BarChart3,
        color: 'green'
      },
      {
        title: 'Data Points',
        value: formatNumber(dashboardStats.totalDataPoints),
        change: '+0%',
        icon: Activity,
        color: 'purple'
      },
      {
        title: 'Storage Used',
        value: formatBytes(dashboardStats.totalSize),
        change: '+0%',
        icon: TrendingUp,
        color: 'yellow'
      }
    ];
  };

  // Load dashboard stats when component mounts
  useEffect(() => {
    updateDashboardStats();
  }, [updateDashboardStats]);

  // Refresh dashboard stats every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      updateDashboardStats();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [updateDashboardStats]);


  // Function to reset upload count
  const resetUploadCount = useCallback(() => {
    setUploadCount(0);
    localStorage.setItem('uploadCount', '0');
  }, []);

  const value = {
    dashboardStats,
    recentActivity,
    loading,
    error,
    uploadCount,
    resetUploadCount,
    updateDashboardStats,
    forceUpdateStats,
    refreshDashboardWithRetry,
    notifyFileUploaded,
    notifyAnalysisCreated,
    getFormattedStats
  };

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};
