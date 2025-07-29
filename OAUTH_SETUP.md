# GitHub Device Flow Authentication

PR Shepherd uses GitHub's **Device Flow** for authentication - no setup required!

## What is Device Flow?

Device Flow is GitHub's authentication method designed for applications that can't securely store client secrets (like browser extensions). It provides:

- **No OAuth app setup required**: Uses GitHub's public Device Flow client
- **Secure authentication**: Users authenticate directly with GitHub
- **Automatic permissions**: Proper scopes are granted automatically  
- **One-click experience**: Simple authentication flow

## How It Works

1. **Click "Connect with GitHub OAuth"** in the extension
2. **Copy the device code** shown in the popup
3. **Visit GitHub** (opens automatically) and paste the code
4. **Authorize PR Shepherd** to access your repositories
5. **Done!** The extension now has secure access to your GitHub data

## Authentication Flow

```
Extension → GitHub Device Code → User Authorization → Access Token
```

1. Extension requests a device code from GitHub
2. User visits GitHub with the device code
3. User authorizes the application
4. Extension receives access token automatically

## Permissions Requested

The extension requests these GitHub scopes:
- **`repo`**: Access to repository data and pull requests
- **`read:org`**: Read organization membership for team assignments

## Fallback Option

If you prefer manual token management, you can still use **Personal Access Tokens**:

1. Click "Use Personal Access Token" 
2. Create a token at https://github.com/settings/tokens
3. Select `repo` and `read:org` scopes
4. Paste the token in the extension

## Security Notes

- ✅ **No secrets stored**: Extension doesn't store any client secrets
- ✅ **Direct GitHub authentication**: Users authenticate with GitHub directly
- ✅ **Local token storage**: Tokens stored securely in Chrome's local storage
- ✅ **No external servers**: All API calls made directly to GitHub
- ✅ **Standard OAuth scopes**: Only requests necessary permissions

## Troubleshooting

### Common Issues

**"Authentication timeout"**
- Device code expired (15 minute limit)
- Try the authentication flow again

**"Authentication was denied"**  
- User declined authorization on GitHub
- Click "Connect with GitHub OAuth" to retry

**"Network error"**
- Check internet connection
- Ensure GitHub is accessible

### Need Help?

If Device Flow isn't working:
1. Try the **Personal Access Token** option as backup
2. Check the browser console for error details
3. Ensure you're using a supported browser (Chrome/Edge/etc)

## No Configuration Required!

Unlike traditional OAuth apps, Device Flow requires **zero setup**:
- ❌ No OAuth app creation needed
- ❌ No client ID configuration  
- ❌ No redirect URL setup
- ✅ Works out of the box for all users!