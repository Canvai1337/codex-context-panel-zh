using System;
using System.IO;
using System.Web.Script.Serialization;
internal static class NativeFixture
{
    private static void Main(string[] args)
    {
        if (args.Length > 0) File.WriteAllText(args[0], new JavaScriptSerializer().Serialize(new {
            command = Environment.CommandLine,
            args = Environment.GetCommandLineArgs()
        }));
    }
}
