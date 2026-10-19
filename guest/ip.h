/* Public-address lookup is the only browser network bridge. Formatting and
 * interface state belong to Linux and BusyBox, not a JavaScript imitation. */
#include <sys/socket.h>
#include <sys/un.h>
#include <arpa/inet.h>
#include <stddef.h>

#define IP_BRIDGE "/run/site-ip.sock"
#define IP_PENDING 8
static int ip_socket=-1;
static unsigned ip_sequence;
static struct {
    unsigned id;
    time_t expires;
    struct sockaddr_un peer;
    socklen_t length;
} ip_pending[IP_PENDING];

static int ip_native(char **args) {
    pid_t child=fork();
    if(child==0) {
        int sink=open("/dev/null",O_WRONLY);
        if(sink>=0) {dup2(sink,STDOUT_FILENO);dup2(sink,STDERR_FILENO);close(sink);}
        execv("/bin/busybox",args);_exit(127);
    }
    if(child<0)return -1;
    int status;
    while(waitpid(child,&status,0)<0)if(errno!=EINTR)return -1;
    return WIFEXITED(status) && WEXITSTATUS(status)==0 ? 0 : -1;
}
#define IP_NATIVE(...) ip_native((char *[]){"busybox","ip",__VA_ARGS__,NULL})

static void ip_init(void) {
    IP_NATIVE("link","set","lo","up");
    IP_NATIVE("link","delete","dummy0");
    ip_socket=socket(AF_UNIX,SOCK_DGRAM|SOCK_NONBLOCK|SOCK_CLOEXEC,0);
    if(ip_socket<0)return;
    struct sockaddr_un address={.sun_family=AF_UNIX,.sun_path=IP_BRIDGE};
    unlink(IP_BRIDGE);
    if(bind(ip_socket,(struct sockaddr *)&address,sizeof(address))) {
        close(ip_socket);ip_socket=-1;
    }
}

static void ip_requests(void) {
    if(ip_socket<0)return;
    time_t now=time(NULL);
    for(int i=0;i<IP_PENDING;i++)if(ip_pending[i].expires<now)ip_pending[i].id=0;
    for(int n=0;n<IP_PENDING;n++) {
        struct sockaddr_un peer={0};socklen_t length=sizeof(peer);
        char request[2];
        ssize_t count=recvfrom(ip_socket,request,sizeof(request),0,(struct sockaddr *)&peer,&length);
        if(count<0)break;
        if(count!=1 || (request[0]!='0' && request[0]!='4' && request[0]!='6'))continue;
        int slot=0;while(slot<IP_PENDING && ip_pending[slot].id)slot++;
        if(slot==IP_PENDING || control<0) {
            sendto(ip_socket,"!busy",5,0,(struct sockaddr *)&peer,length);continue;
        }
        ip_pending[slot].id=++ip_sequence;
        ip_pending[slot].expires=now+20;
        ip_pending[slot].peer=peer;ip_pending[slot].length=length;
        dprintf(control,"{\"publicIpRequest\":%u,\"family\":%c}\n",ip_sequence,request[0]);
    }
}

static int ip_assign(const char *address,int family) {
    /* Keep the interface identity stable; replace only the observed address.
     * Do not present an automatically generated IPv6 link-local as public. */
    if(IP_NATIVE("link","show","dev","public0") &&
       IP_NATIVE("link","add","public0","type","dummy"))return -1;
    FILE *setting=fopen("/proc/sys/net/ipv6/conf/public0/addr_gen_mode","w");
    if(setting) {fputs("1\n",setting);fclose(setting);}
    setting=fopen("/proc/sys/net/ipv6/conf/public0/accept_dad","w");
    if(setting) {fputs("0\n",setting);fclose(setting);}
    char prefix[INET6_ADDRSTRLEN+5];
    snprintf(prefix,sizeof(prefix),"%s/%d",address,family==AF_INET ? 32 : 128);
    if(IP_NATIVE("address","flush","dev","public0","scope","global"))return -1;
    if(IP_NATIVE("address","add",prefix,"dev","public0"))return -1;
    return IP_NATIVE("link","set","public0","up");
}

static void ip_response(unsigned id,const char *address) {
    for(int i=0;i<IP_PENDING;i++)if(ip_pending[i].id==id) {
        /* A canceled command has closed its abstract socket. Probe it before
         * touching interface state; an empty datagram isn't command output. */
        struct sockaddr *peer=(struct sockaddr *)&ip_pending[i].peer;
        if(sendto(ip_socket,"",0,0,peer,ip_pending[i].length)<0) {ip_pending[i].id=0;return;}
        unsigned char bytes[16];
        int family=inet_pton(AF_INET,address,bytes)==1 ? AF_INET :
            inet_pton(AF_INET6,address,bytes)==1 ? AF_INET6 : 0;
        const char *reply="!lookup";
        if(family)reply=ip_assign(address,family) ? "!interface" : "ok";
        sendto(ip_socket,reply,strlen(reply),0,peer,ip_pending[i].length);
        ip_pending[i].id=0;return;
    }
}

static int shell_ip(int argc,char **argv) {
    int object=1;char family='0';
    while(object<argc && argv[object][0]=='-') {
        if(!strcmp(argv[object],"-4"))family='4';
        if(!strcmp(argv[object],"-6"))family='6';
        object++;
    }
    int show=object<argc && *argv[object] && !strncmp("address",argv[object],strlen(argv[object]));
    if(show && object+1<argc) {
        const char *action=argv[object+1];
        show=*action && (!strncmp("show",action,strlen(action)) || !strncmp("list",action,strlen(action)) || !strcmp(action,"lst"));
    }
    if(show) {
        int fd=socket(AF_UNIX,SOCK_DGRAM|SOCK_CLOEXEC,0);
        struct sockaddr_un local={.sun_family=AF_UNIX};
        struct sockaddr_un server={.sun_family=AF_UNIX,.sun_path=IP_BRIDGE};
        /* Linux autobinds an abstract address; it disappears even on Ctrl+C. */
        if(fd<0 || bind(fd,(struct sockaddr *)&local,sizeof(local.sun_family)) ||
           connect(fd,(struct sockaddr *)&server,sizeof(server)) || send(fd,&family,1,0)!=1) {
            if(fd>=0)close(fd);
            fputs("ip: public IP lookup unavailable\n",stderr);return 1;
        }
        char reply[32]={0};struct pollfd event={.fd=fd,.events=POLLIN};
        time_t deadline=time(NULL)+12;
        while(time(NULL)<deadline) {
            int remaining=(int)(deadline-time(NULL))*1000;
            int result=poll(&event,1,remaining>0 ? remaining : 1);
            if(result<0 && errno==EINTR)continue;
            if(result<=0)break;
            ssize_t n=recv(fd,reply,sizeof(reply)-1,0);
            if(n>0) {reply[n]=0;break;}
        }
        close(fd);
        if(strcmp(reply,"ok")) {
            fputs(!strcmp(reply,"!interface") ? "ip: could not configure public0\n" :
                  "ip: public IP lookup failed; check your connection and try again\n",stderr);
            return 1;
        }
    }
    char **args=calloc((size_t)argc+2,sizeof(char *));
    if(!args)return 1;
    args[0]="busybox";args[1]="ip";
    for(int i=1;i<argc;i++)args[i+1]=argv[i];
    execv("/bin/busybox",args);
    perror("ip");free(args);return 1;
}
